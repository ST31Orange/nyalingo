/**
 * 翻译服务：NyaLingo 核心编排。
 * 职责：Provider 选择、分块、缓存、并发去重、错误归一化。
 * 视图层（NyaHome / NyaReader）通过本服务获取译文，不直接触碰 Provider。
 */
import type { ITranslationProvider } from "./providers";
import { createProvider } from "./providers";
import type { HttpTransport } from "./http";
import type { NyaLingoSettings } from "./settings";
import { splitTranslationChunks } from "./text";
import { TranslationCache, translationKey, ITranslationCacheStore } from "./cache";

export interface TranslationServiceDeps {
	config: () => NyaLingoSettings;
	http: HttpTransport;
	persistentCacheStore?: ITranslationCacheStore;
}

export interface TranslateOptions {
	from?: string;
	to?: string;
	/** 传 true 时按 HTML 处理（用于富文本来源），默认纯文本。 */
	html?: boolean;
}

export class TranslationService {
	private provider: ITranslationProvider;
	private cache: TranslationCache;
	private inFlight = new Map<string, Promise<string>>();

	constructor(private deps: TranslationServiceDeps) {
		const cfg = this.deps.config();
		this.cache = new TranslationCache(deps.persistentCacheStore ?? null, cfg.cacheMaxEntries);
		this.provider = createProvider({ config: deps.config, http: deps.http });
	}

	async initialize(): Promise<void> {
		await this.cache.load();
	}

	getProviderInfo(): { id: string; displayName: string } {
		return { id: this.provider.id, displayName: this.provider.displayName };
	}

	/** 设置变更后重建 Provider 与缓存参数。 */
	async reloadConfig(): Promise<void> {
		const cfg = this.deps.config();
		this.provider = createProvider({ config: this.deps.config, http: this.deps.http });
		this.cache = new TranslationCache(this.deps.persistentCacheStore ?? null, cfg.cacheMaxEntries);
		await this.cache.load();
	}

	/**
	 * 翻译一段文本。失败抛带用户可读信息的错误。
	 */
	async translate(text: string, opts: TranslateOptions = {}): Promise<string> {
		const cfg = this.deps.config();
		const from = opts.from ?? cfg.sourceLanguage;
		const to = opts.to ?? cfg.targetLanguage;
		const html = opts.html ?? false;
		if (!text.trim()) return "";

		const chunks = splitTranslationChunks(text);
		// 并发去重：同一文本+语言对只有一个在途请求
		const joinedKey = translationKey(text, from, to, this.provider.id);
		const pending = this.inFlight.get(joinedKey);
		if (pending) return pending;

		const task = this.translateChunks(chunks, from, to, html, cfg).finally(() => this.inFlight.delete(joinedKey));
		this.inFlight.set(joinedKey, task);
		return task;
	}

	private async translateChunks(
		chunks: ReturnType<typeof splitTranslationChunks>,
		from: string,
		to: string,
		html: boolean,
		cfg: NyaLingoSettings
	): Promise<string> {
		const values: string[] = [];
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			const key = translationKey(chunk.text, from, to, this.provider.id);
			let part: string;
			if (cfg.cacheEnabled) {
				const cached = this.cache.get(key);
				if (cached !== undefined) {
					part = cached;
				} else {
					part = await this.fetchAndCache(chunk.text, from, to, html, key);
				}
			} else {
				part = (await this.provider.translateText(chunk.text, html, from, to)).translatedText;
			}
			values.push(i < chunks.length - 1 ? part + chunks[i].separator : part);
		}
		return values.join("");
	}

	private async fetchAndCache(text: string, from: string, to: string, html: boolean, key: string): Promise<string> {
		const result = await this.provider.translateText(text, html, from, to);
		this.cache.set(key, result.translatedText);
		void this.cache.persist();
		return result.translatedText;
	}

	/** 连通性测试：返回人类可读结果。 */
	async testConnection(): Promise<{ ok: boolean; detail?: string }> {
		try {
			await this.provider.translateText("ok", false, this.deps.config().sourceLanguage, this.deps.config().targetLanguage);
			return { ok: true };
		} catch (e) {
			return { ok: false, detail: e instanceof Error ? e.message : String(e) };
		}
	}

	async healthCheck(): Promise<boolean> {
		return this.provider.healthCheck();
	}

	async clearCache(): Promise<void> {
		this.cache.clear();
		await this.cache.persist();
	}
}
