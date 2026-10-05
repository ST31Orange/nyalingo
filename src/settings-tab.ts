/**
 * NyaLingo 设置面板。
 * 面向普通用户：按"离线翻译 / 在线翻译"分组，目标语言默认中英互译，
 * 提供"测试连接"与"清空缓存"，并引导离线引擎安装。
 */
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type NyaLingoPlugin from "./main";
import { TRANSLATION_PROVIDERS, LANGUAGES } from "./settings";
import type { TranslationProviderType } from "./settings";

export class NyaLingoSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: NyaLingoPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "NyaLingo 翻译设置" });
		containerEl.createEl("p", {
			cls: "nyalingo-hint",
			text: "NyaHome 与 NyaReader 共用的翻译服务。这里配置一次，两个插件都会使用。",
		});

		// ---------- 引擎 ----------
		containerEl.createEl("h3", { text: "翻译引擎" });
		new Setting(containerEl)
			.setName("引擎")
			.setDesc("离线：MTranServer（本地运行、无需联网、隐私安全）；在线：OpenAI 兼容 / DeepL")
			.addDropdown((d) => {
				for (const p of TRANSLATION_PROVIDERS) d.addOption(p.id, p.label);
				d.setValue(this.plugin.settings.provider).onChange(async (v) => {
					this.plugin.settings.provider = v as TranslationProviderType;
					if (v === "mtran") this.plugin.settings.mode = "offline";
					else this.plugin.settings.mode = "online";
					await this.plugin.saveSettings();
					await this.plugin.service.reloadConfig();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("目标语言")
			.setDesc("译文语言（默认中英互译）")
			.addDropdown((d) => {
				for (const [code, label] of Object.entries(LANGUAGES)) d.addOption(code, label);
				d.setValue(this.plugin.settings.targetLanguage).onChange(async (v) => {
					this.plugin.settings.targetLanguage = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("源语言").setDesc("通常保持自动检测即可").addDropdown((d) => {
			d.addOption("auto", "自动检测");
			for (const [code, label] of Object.entries(LANGUAGES)) d.addOption(code, label);
			d.setValue(this.plugin.settings.sourceLanguage).onChange(async (v) => {
				this.plugin.settings.sourceLanguage = v;
				await this.plugin.saveSettings();
			});
		});

		// ---------- 离线（MTranServer） ----------
		containerEl.createEl("h3", { text: "离线翻译（MTranServer）" });
		new Setting(containerEl)
			.setName("引擎地址")
			.setDesc("MTranServer 默认监听 http://127.0.0.1:8989，通常无需修改；只有你改了端口才需要改这里。")
			.addText((t) =>
				t
					.setPlaceholder("http://127.0.0.1:8989")
					.setValue(this.plugin.settings.offlineEndpoint)
					.onChange(async (v) => {
						this.plugin.settings.offlineEndpoint = v;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("访问令牌（可选）")
			.setDesc("若你的引擎配置了鉴权")
			.addText((t) =>
				t
					.setPlaceholder("Bearer Token")
					.setValue(this.plugin.settings.offlineToken)
					.onChange(async (v) => {
						this.plugin.settings.offlineToken = v;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("如何安装离线引擎？")
			.setDesc("MTranServer 是免费开源项目，下载桌面端安装包即可在本地运行。")
			.addButton((b) =>
				b.setButtonText("打开安装向导").setCta().onClick(() => {
					void this.plugin.openSetupWizard();
				})
			)
			.addButton((b) =>
				b.setButtonText("测试连接").onClick(async () => {
					await this.testOffline();
				})
			);

		// ---------- 离线语言包 ----------
		containerEl.createEl("h3", { text: "离线语言包" });
		containerEl.createEl("p", {
			cls: "nyalingo-hint",
			text: "中英互译（en ↔ 简体中文）已默认启用，首次翻译时 MTranServer 会自动下载对应模型。这里只需按需下载其他目标语言的语言包。",
		});
		new Setting(containerEl)
			.setName("中英互译（默认）")
			.setDesc("en ↔ 简体中文（zh-Hans）已默认启用")
			.addButton((b) => b.setButtonText("已启用").setDisabled(true));

		const dlRow = new Setting(containerEl).setName("下载其他语言包").setDesc("选择一个目标语言，点击下载后 MTranServer 会自动下载该语言模型。");
		dlRow.addDropdown((d) => {
			for (const [code, label] of Object.entries(LANGUAGES)) {
				if (code === "zh-Hans") continue;
				d.addOption(code, label);
			}
			d.setValue("ja");
		});
		dlRow.addButton((b) =>
			b.setButtonText("下载语言包").onClick(async () => {
				const code = (dlRow.settingEl.querySelector("select") as HTMLSelectElement | null)?.value ?? "ja";
				const label = LANGUAGES[code] ?? code;
				b.setDisabled(true);
				b.setButtonText("下载中…");
				try {
					await this.plugin.downloadOfflineLanguage(code, "en");
					if (!this.plugin.settings.installedLanguages.includes(code)) {
						this.plugin.settings.installedLanguages.push(code);
						await this.plugin.saveSettings();
					}
					new Notice(`NyaLingo：${label} 语言包已就绪。`);
				} catch (e) {
					new Notice(`NyaLingo：下载失败 — ${e instanceof Error ? e.message : String(e)}`, 8000);
				} finally {
					b.setDisabled(false);
					b.setButtonText("下载语言包");
				}
			})
		);

		// ---------- 在线（OpenAI 兼容） ----------
		containerEl.createEl("h3", { text: "在线翻译（OpenAI 兼容 / DeepL）" });
		new Setting(containerEl)
			.setName("API 地址")
			.setDesc("OpenAI 兼容服务，例如 https://api.openai.com/v1")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.openaiBaseUrl)
					.onChange(async (v) => {
						this.plugin.settings.openaiBaseUrl = v;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("API Key")
			.setDesc("OpenAI 兼容服务密钥")
			.addText((t) =>
				t
					.setPlaceholder("sk-…")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (v) => {
						this.plugin.settings.openaiApiKey = v;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("模型名称")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.openaiModel)
					.onChange(async (v) => {
						this.plugin.settings.openaiModel = v;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("DeepL API Key")
			.addText((t) =>
				t
					.setPlaceholder("DeepL-Auth-Key …")
					.setValue(this.plugin.settings.deeplApiKey)
					.onChange(async (v) => {
						this.plugin.settings.deeplApiKey = v;
						await this.plugin.saveSettings();
					})
			);

		// ---------- 通用 ----------
		containerEl.createEl("h3", { text: "通用" });
		new Setting(containerEl)
			.setName("请求超时（毫秒）")
			.addSlider((s) => {
				s.setLimits(1000, 120000, 1000)
					.setValue(this.plugin.settings.timeoutMs)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.timeoutMs = v;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("翻译缓存")
			.setDesc("缓存已翻译的文本，避免重复请求")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.cacheEnabled).onChange(async (v) => {
					this.plugin.settings.cacheEnabled = v;
					await this.plugin.saveSettings();
				})
			)
			.addButton((b) =>
				b.setButtonText("清空缓存").onClick(async () => {
					await this.plugin.service.clearCache();
					new Notice("NyaLingo：翻译缓存已清空。");
				})
			);
	}

	private async testOffline(): Promise<void> {
		const r = await this.plugin.service.testConnection();
		new Notice(r.ok ? "NyaLingo：连接成功 ✅" : `NyaLingo：连接失败 — ${r.detail ?? "未知错误"}`);
	}
}
