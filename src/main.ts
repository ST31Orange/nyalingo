/**
 * NyaLingo 主入口：翻译服务插件。
 * 供 NyaHome / NyaReader 共用：两插件只做 UI（划词触发、译文展示），
 * 通过 app.plugins.getPlugin("nyalingo") 调用本插件公开 API。
 * 翻译配置只在本插件存一份，避免两插件重复配置。
 */
import { Notice, Plugin } from "obsidian";
import { NyaLingoSettings, normalizeSettings } from "./settings";
import { NyaLingoSettingTab } from "./settings-tab";
import { TranslationService } from "./service";
import { obsidianHttpTransport } from "./http";
import { openSetupWizard } from "./setup-wizard";

/** NyaLingo 对外暴露的公共 API（供 NyaHome / NyaReader 等插件调用）。 */
export interface NyaLingoApi {
	/** 翻译一段文本；失败抛带用户可读信息的错误。 */
	translate(text: string, opts?: { from?: string; to?: string; html?: boolean }): Promise<string>;
	/** 连通性探测（引擎是否可用）。 */
	healthCheck(): Promise<boolean>;
	/** 读取当前设置（只读快照，修改请走设置面板）。 */
	getConfig(): NyaLingoSettings;
	/** 订阅设置变更，返回取消函数。 */
	onSettingsChange(cb: (cfg: NyaLingoSettings) => void): () => void;
	/** 测试连接，返回人类可读结果。 */
	testConnection(): Promise<{ ok: boolean; detail?: string }>;
	/** 打开离线引擎安装向导。 */
	openSetupWizard(): void;
	/** 清空翻译缓存。 */
	clearCache(): Promise<void>;
}

export default class NyaLingoPlugin extends Plugin implements NyaLingoApi {
	settings!: NyaLingoSettings;
	service!: TranslationService;
	private settingsListeners = new Set<(cfg: NyaLingoSettings) => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.service = new TranslationService({
			config: () => this.settings,
			http: obsidianHttpTransport,
			persistentCacheStore: {
				load: async () => {
					try {
						const raw = await this.app.vault.adapter.read(`${this.manifest.dir ?? ""}nyalingo-cache.json`.replace(/\/+/g, "/"));
						return JSON.parse(raw) as Record<string, string>;
					} catch {
						return {};
					}
				},
				save: async (data: Record<string, string>) => {
					await this.app.vault.adapter.write(`${this.manifest.dir ?? ""}nyalingo-cache.json`.replace(/\/+/g, "/"), JSON.stringify(data));
				},
			},
		});
		await this.service.initialize();

		this.addCommand({
			id: "open-settings",
			name: "打开翻译设置…",
			callback: () => this.openSettingsTab(),
		});
		this.addCommand({
			id: "open-setup-wizard",
			name: "离线翻译引擎安装向导…",
			callback: () => this.openSetupWizard(),
		});

		this.addSettingTab(new NyaLingoSettingTab(this.app, this));
	}

	onunload(): void {
		this.settingsListeners.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.notifySettingsChanged();
	}

	/** 打开本插件设置面板（Obsidian 无公开 API，用内部对象并做降级）。 */
	private openSettingsTab(): void {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const setting = (this.app as any).setting as { open?(): void; openTabById?(id: string): void } | undefined;
			setting?.open?.();
			setting?.openTabById?.("nyalingo");
		} catch {
			new Notice("请在设置 → 第三方插件 → NyaLingo 中配置。");
		}
	}

	// ---------- NyaLingoApi ----------

	translate(text: string, opts?: { from?: string; to?: string; html?: boolean }): Promise<string> {
		return this.service.translate(text, opts);
	}

	healthCheck(): Promise<boolean> {
		return this.service.healthCheck();
	}

	getConfig(): NyaLingoSettings {
		return { ...this.settings };
	}

	onSettingsChange(cb: (cfg: NyaLingoSettings) => void): () => void {
		this.settingsListeners.add(cb);
		return () => this.settingsListeners.delete(cb);
	}

	async testConnection(): Promise<{ ok: boolean; detail?: string }> {
		return this.service.testConnection();
	}

	openSetupWizard(): void {
		openSetupWizard(this.app, {
			initialEndpoint: this.settings.offlineEndpoint,
			onSaveEndpoint: async (endpoint) => {
				this.settings.offlineEndpoint = endpoint;
				this.settings.mode = "offline";
				this.settings.provider = "mtran";
				await this.saveSettings();
				await this.service.reloadConfig();
			},
			onSwitchToOnline: async () => {
				this.settings.mode = "online";
				await this.saveSettings();
				await this.service.reloadConfig();
			},
			http: obsidianHttpTransport,
			onDone: () => new Notice("NyaLingo：翻译服务已就绪。"),
		});
	}

	async clearCache(): Promise<void> {
		await this.service.clearCache();
	}

	/** 从离线引擎导入既有配置（供迁移既有 NyaHome 配置时调用）。 */
	async importConfig(patch: Partial<NyaLingoSettings>): Promise<void> {
		this.settings = normalizeSettings({ ...this.settings, ...patch });
		await this.saveSettings();
		await this.service.reloadConfig();
	}

	private notifySettingsChanged(): void {
		const snapshot = { ...this.settings };
		for (const cb of this.settingsListeners) {
			try {
				cb(snapshot);
			} catch {
				/* 单监听器异常不影响其他 */
			}
		}
	}
}
