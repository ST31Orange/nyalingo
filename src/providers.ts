/**
 * 翻译 Provider 抽象与三套实现：MTranServer（离线）/ OpenAI 兼容 / DeepL（在线）。
 */
import type { HttpTransport } from "./http";
import type { NyaLingoSettings } from "./settings";

export interface TranslationTextResult {
	translatedText: string;
	fromCache: boolean;
}

export interface ITranslationProvider {
	readonly id: string;
	readonly displayName: string;
	translateText(text: string, html: boolean, from: string, to: string): Promise<TranslationTextResult>;
	healthCheck(): Promise<boolean>;
}

export interface ProviderDeps {
	config: () => NyaLingoSettings;
	http: HttpTransport;
}

export function createProvider(deps: ProviderDeps): ITranslationProvider {
	const cfg = deps.config();
	switch (cfg.provider) {
		case "openai":
			return new OpenAICompatibleProvider(deps);
		case "deepl":
			return new DeepLProvider(deps);
		case "mtran":
		default:
			return new MTranServerProvider(deps);
	}
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`翻译请求超时（${ms}ms）。`)), ms);
		task.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

/** OpenAI 兼容 Chat Completions。 */
export class OpenAICompatibleProvider implements ITranslationProvider {
	readonly id = "openai";
	readonly displayName = "OpenAI 兼容 API";
	constructor(private deps: ProviderDeps) {}

	private cfg() {
		return this.deps.config();
	}

	private endpoint(): string {
		return `${this.cfg().openaiBaseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
	}

	async translateText(text: string, _html: boolean, from: string, to: string): Promise<TranslationTextResult> {
		const cfg = this.cfg();
		const body = {
			model: cfg.openaiModel,
			messages: [
				{ role: "system", content: `You are a translation engine. Translate the user's text into ${to}. Only output the translation, no explanation.` },
				{ role: "user", content: text },
			],
			temperature: 0.2,
		};
		const res = await withTimeout(
			this.deps.http.request({
				url: this.endpoint(),
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.openaiApiKey.trim()}` },
				body: JSON.stringify(body),
				timeoutMs: cfg.timeoutMs,
			}),
			cfg.timeoutMs + 1000
		);
		if (res.status >= 400) throw new Error(`OpenAI 翻译失败（HTTP ${res.status}）: ${res.body.slice(0, 300)}`);
		const data = JSON.parse(res.body) as { choices?: Array<{ message?: { content?: string } }> };
		const content = data.choices?.[0]?.message?.content?.trim();
		if (!content) throw new Error("OpenAI 翻译返回为空。");
		return { translatedText: content, fromCache: false };
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.translateText("ok", false, this.cfg().sourceLanguage, this.cfg().targetLanguage);
			return true;
		} catch {
			return false;
		}
	}
}

/** DeepL REST v2。 */
export class DeepLProvider implements ITranslationProvider {
	readonly id = "deepl";
	readonly displayName = "DeepL";
	constructor(private deps: ProviderDeps) {}

	private cfg() {
		return this.deps.config();
	}

	private endpoint(): string {
		return `${this.cfg().deeplBaseUrl.trim().replace(/\/+$/, "")}/translate`;
	}

	async translateText(text: string, _html: boolean, from: string, to: string): Promise<TranslationTextResult> {
		const cfg = this.cfg();
		const params = new URLSearchParams();
		params.set("text", text);
		params.set("source_lang", from === "auto" ? "auto" : from.toUpperCase().replace(/-.*$/, ""));
		params.set("target_lang", to.toUpperCase().replace(/-.*$/, ""));
		const res = await withTimeout(
			this.deps.http.request({
				url: this.endpoint(),
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `DeepL-Auth-Key ${cfg.deeplApiKey.trim()}` },
				body: params.toString(),
				timeoutMs: cfg.timeoutMs,
			}),
			cfg.timeoutMs + 1000
		);
		if (res.status >= 400) throw new Error(`DeepL 翻译失败（HTTP ${res.status}）: ${res.body.slice(0, 300)}`);
		const data = JSON.parse(res.body) as { translations?: Array<{ text?: string }> };
		const content = data.translations?.[0]?.text?.trim();
		if (!content) throw new Error("DeepL 翻译返回为空。");
		return { translatedText: content, fromCache: false };
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.translateText("ok", false, this.cfg().sourceLanguage, this.cfg().targetLanguage);
			return true;
		} catch {
			return false;
		}
	}
}

/** MTranServer（本地离线）。 */
export class MTranServerProvider implements ITranslationProvider {
	readonly id = "mtran";
	readonly displayName = "MTranServer（本地离线翻译）";
	constructor(private deps: ProviderDeps) {}

	private cfg() {
		return this.deps.config();
	}

	private endpoint(): string {
		const base = this.cfg().offlineEndpoint.trim().replace(/\/+$/, "");
		if (!base) return "";
		return /\/translate\/?$/i.test(base) ? base : `${base}/translate`;
	}

	async translateText(text: string, html: boolean, from: string, to: string): Promise<TranslationTextResult> {
		const cfg = this.cfg();
		if (!cfg.offlineEndpoint.trim()) throw new Error("MTranServer 地址未配置。请在 NyaLingo 设置中填写离线引擎地址。");
		// MTranServer /translate 要求具体源语言码，不支持 "auto"。
		// 源语言为 auto 时先用 /detect 识别，识别失败回退 en，避免错误语言对产生废译文。
		const fromCode = from === "auto" ? await this.detectLanguage(text) : from;
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (cfg.offlineToken.trim()) headers.Authorization = `Bearer ${cfg.offlineToken.trim()}`;
		const res = await withTimeout(
			this.deps.http.request({
				url: this.endpoint(),
				method: "POST",
				headers,
				body: JSON.stringify({ from: fromCode, to, text, html }),
				timeoutMs: cfg.timeoutMs,
			}),
			cfg.timeoutMs + 1000
		);
		if (res.status >= 400) throw new Error(`MTranServer 翻译失败（HTTP ${res.status}）: ${res.body.slice(0, 300)}`);
		let parsed: { translatedText?: unknown; result?: unknown };
		try {
			parsed = JSON.parse(res.body);
		} catch {
			throw new Error("MTranServer 返回了非 JSON 内容。");
		}
		const translated = typeof parsed.translatedText === "string" ? parsed.translatedText : parsed.result;
		if (typeof translated !== "string") throw new Error("MTranServer 响应缺少译文。");
		return { translatedText: translated, fromCache: false };
	}

	/** 通过 MTranServer /detect 识别文本语言；失败回退 "en"。 */
	private async detectLanguage(text: string): Promise<string> {
		const cfg = this.cfg();
		const base = cfg.offlineEndpoint.trim().replace(/\/+$/, "");
		try {
			const res = await withTimeout(
				this.deps.http.request({
					url: `${base}/detect`,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					// 注意：/detect 的 schema 只接受 text，多余的字段会 500
					body: JSON.stringify({ text: text.slice(0, 1000) }),
					timeoutMs: Math.min(cfg.timeoutMs, 8000),
				}),
				10000
			);
			if (res.status >= 400) return "en";
			const parsed = JSON.parse(res.body) as { language?: string };
			return typeof parsed.language === "string" && parsed.language ? parsed.language : "en";
		} catch {
			return "en";
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.translateText("ok", false, this.cfg().sourceLanguage, this.cfg().targetLanguage);
			return true;
		} catch {
			return false;
		}
	}
}
