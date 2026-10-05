/**
 * NyaLingo 设置类型、默认值与归一化。
 * 同时支持离线（MTranServer）与在线（OpenAI 兼容 / DeepL）翻译。
 */
export type TranslationProviderType = "mtran" | "openai" | "deepl";

export type TranslationMode = "offline" | "online";

export interface NyaLingoSettings {
	mode: TranslationMode;
	provider: TranslationProviderType;
	/** 默认语言对 */
	sourceLanguage: string;
	targetLanguage: string;
	/** 离线引擎（MTranServer） */
	offlineEndpoint: string;
	offlineToken: string;
	/** 已启用的离线语言包（目标语言代码）；默认仅中英互译（zh-Hans）。 */
	installedLanguages: string[];
	/** 插件加载时若检测到 MTranServer 未运行，则自动尝试启动。 */
	autoStartOffline: boolean;
	/** OpenAI 兼容 */
	openaiBaseUrl: string;
	openaiApiKey: string;
	openaiModel: string;
	/** DeepL */
	deeplApiKey: string;
	deeplBaseUrl: string;
	/** 通用 */
	timeoutMs: number;
	cacheEnabled: boolean;
	cacheMaxEntries: number;
}

export const DEFAULT_SETTINGS: NyaLingoSettings = {
	mode: "offline",
	provider: "mtran",
	sourceLanguage: "en",
	targetLanguage: "zh-Hans",
	offlineEndpoint: "http://127.0.0.1:8989",
	offlineToken: "",
	installedLanguages: ["zh-Hans"],
	autoStartOffline: true,
	openaiBaseUrl: "https://api.openai.com/v1",
	openaiApiKey: "",
	openaiModel: "gpt-4o-mini",
	deeplApiKey: "",
	deeplBaseUrl: "https://api-free.deepl.com/v2",
	timeoutMs: 15000,
	cacheEnabled: true,
	cacheMaxEntries: 500,
};

/** 可选引擎（用于设置面板下拉）。 */
export const TRANSLATION_PROVIDERS: Array<{ id: TranslationProviderType; label: string }> = [
	{ id: "mtran", label: "MTranServer（本地离线）" },
	{ id: "openai", label: "OpenAI 兼容 API" },
	{ id: "deepl", label: "DeepL" },
];

/** 常用语言（目标语言 / 源语言下拉）。 */
export const LANGUAGES: Record<string, string> = {
	"zh-Hans": "简体中文",
	"zh-Hant": "繁體中文",
	en: "English",
	ja: "日本語",
	ko: "한국어",
	fr: "Français",
	de: "Deutsch",
	es: "Español",
	ru: "Русский",
	ar: "العربية",
	pt: "Português",
	it: "Italiano",
	th: "ไทย",
	vi: "Tiếng Việt",
};

/** 归一化用户数据，保证运行时永远拿到合法形状。 */
export function normalizeSettings(raw: unknown): NyaLingoSettings {
	const v = (raw ?? {}) as Partial<NyaLingoSettings>;
	return {
		mode: v.mode === "online" ? "online" : "offline",
		provider: isProvider(v.provider) ? v.provider : DEFAULT_SETTINGS.provider,
		sourceLanguage: strOr(v.sourceLanguage, DEFAULT_SETTINGS.sourceLanguage),
		targetLanguage: strOr(v.targetLanguage, DEFAULT_SETTINGS.targetLanguage),
		offlineEndpoint: strOr(v.offlineEndpoint, "http://127.0.0.1:8989"),
		offlineToken: strOr(v.offlineToken, ""),
		installedLanguages: arrayOfStrings(v.installedLanguages).length ? arrayOfStrings(v.installedLanguages) : ["zh-Hans"],
		autoStartOffline: v.autoStartOffline !== false,
		openaiBaseUrl: strOr(v.openaiBaseUrl, DEFAULT_SETTINGS.openaiBaseUrl),
		openaiApiKey: strOr(v.openaiApiKey, ""),
		openaiModel: strOr(v.openaiModel, DEFAULT_SETTINGS.openaiModel),
		deeplApiKey: strOr(v.deeplApiKey, ""),
		deeplBaseUrl: strOr(v.deeplBaseUrl, DEFAULT_SETTINGS.deeplBaseUrl),
		timeoutMs: clamp(Number(v.timeoutMs), 1000, 120000, DEFAULT_SETTINGS.timeoutMs),
		cacheEnabled: v.cacheEnabled !== false,
		cacheMaxEntries: clamp(Number(v.cacheMaxEntries), 10, 10000, DEFAULT_SETTINGS.cacheMaxEntries),
	};
}

function clamp(n: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
function strOr(v: unknown, fallback: string): string {
	return typeof v === "string" && v ? v : fallback;
}
function isProvider(v: unknown): v is TranslationProviderType {
	return v === "mtran" || v === "openai" || v === "deepl";
}

function arrayOfStrings(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
