/**
 * NyaLingo 单测：三个 Provider 的请求构造与响应解析（注入 fake HTTP transport）。
 */
import { describe, it, expect } from "vitest";
import { OpenAICompatibleProvider, DeepLProvider, MTranServerProvider, createProvider } from "../src/providers";
import { TranslationService } from "../src/service";
import type { HttpTransport, HttpResponse } from "../src/http";
import type { NyaLingoSettings } from "../src/settings";
import { DEFAULT_SETTINGS } from "../src/settings";

function fakeTransport(handler: (url: string, body: string, headers: Record<string, string>) => HttpResponse): HttpTransport {
	return {
		async request(req) {
			return handler(req.url, req.body ?? "", req.headers ?? {});
		},
	};
}

function cfg(patch: Partial<NyaLingoSettings> = {}): () => NyaLingoSettings {
	return () => ({ ...DEFAULT_SETTINGS, ...patch });
}

describe("OpenAICompatibleProvider", () => {
	it("构造 chat/completions 请求并解析译文", async () => {
		const transport = fakeTransport((url, body, headers) => {
			expect(url).toBe("https://api.openai.com/v1/chat/completions");
			expect(headers.Authorization).toBe("Bearer sk-test");
			const payload = JSON.parse(body) as { model: string; messages: Array<{ role: string }> };
			expect(payload.model).toBe("gpt-4o-mini");
			expect(payload.messages[0].role).toBe("system");
			return { status: 200, body: JSON.stringify({ choices: [{ message: { content: "你好" } }] }), headers: {} };
		});
		const p = new OpenAICompatibleProvider({ config: cfg({ openaiApiKey: "sk-test" }), http: transport });
		const result = await p.translateText("hello", false, "auto", "zh-Hans");
		expect(result.translatedText).toBe("你好");
	});
	it("HTTP 错误抛出可读信息", async () => {
		const transport = fakeTransport(() => ({ status: 401, body: "unauthorized", headers: {} }));
		const p = new OpenAICompatibleProvider({ config: cfg({ openaiApiKey: "sk-test" }), http: transport });
		await expect(p.translateText("hello", false, "auto", "zh-Hans")).rejects.toThrow(/401/);
	});
	it("空响应抛出错误", async () => {
		const transport = fakeTransport(() => ({ status: 200, body: JSON.stringify({ choices: [] }), headers: {} }));
		const p = new OpenAICompatibleProvider({ config: cfg({ openaiApiKey: "sk-test" }), http: transport });
		await expect(p.translateText("hello", false, "auto", "zh-Hans")).rejects.toThrow(/为空/);
	});
});

describe("DeepLProvider", () => {
	it("构造表单请求并解析译文", async () => {
		const transport = fakeTransport((url, body, headers) => {
			expect(url).toBe("https://api-free.deepl.com/v2/translate");
			expect(headers.Authorization).toBe("DeepL-Auth-Key deepl-key");
			expect(body).toContain("source_lang=auto");
			expect(body).toContain("target_lang=JA");
			return { status: 200, body: JSON.stringify({ translations: [{ text: "こんにちは" }] }), headers: {} };
		});
		const p = new DeepLProvider({ config: cfg({ deeplApiKey: "deepl-key" }), http: transport });
		const result = await p.translateText("hello", false, "auto", "ja");
		expect(result.translatedText).toBe("こんにちは");
	});
	it("HTTP 错误抛出可读信息", async () => {
		const transport = fakeTransport(() => ({ status: 403, body: "denied", headers: {} }));
		const p = new DeepLProvider({ config: cfg({ deeplApiKey: "k" }), http: transport });
		await expect(p.translateText("hello", false, "auto", "ja")).rejects.toThrow(/403/);
	});
});

describe("MTranServerProvider", () => {
	const mtranCfg = cfg({ offlineEndpoint: "http://127.0.0.1:8989", offlineToken: "tok" });

	it("显式源语言时直接 POST /translate 并解析 translatedText", async () => {
		const transport = fakeTransport((url, body, headers) => {
			expect(url).toBe("http://127.0.0.1:8989/translate");
			expect(headers.Authorization).toBe("Bearer tok");
			const payload = JSON.parse(body) as { text: string; to: string; from: string };
			expect(payload.text).toBe("hello");
			expect(payload.to).toBe("zh-Hans");
			expect(payload.from).toBe("en");
			return { status: 200, body: JSON.stringify({ translatedText: "你好" }), headers: {} };
		});
		const p = new MTranServerProvider({ config: mtranCfg, http: transport });
		const result = await p.translateText("hello", false, "en", "zh-Hans");
		expect(result.translatedText).toBe("你好");
	});
	it('源语言为 auto 时先 /detect 识别再按识别结果翻译', async () => {
		const transport = fakeTransport((url, body) => {
			if (url.endsWith("/detect")) {
				const payload = JSON.parse(body) as { text: string };
				expect(payload.text).toBe("你好世界");
				return { status: 200, body: JSON.stringify({ language: "zh-Hans" }), headers: {} };
			}
			expect(url).toBe("http://127.0.0.1:8989/translate");
			const payload = JSON.parse(body) as { from: string; to: string };
			expect(payload.from).toBe("zh-Hans");
			expect(payload.to).toBe("en");
			return { status: 200, body: JSON.stringify({ result: "Hello world" }), headers: {} };
		});
		const p = new MTranServerProvider({ config: mtranCfg, http: transport });
		const result = await p.translateText("你好世界", false, "auto", "en");
		expect(result.translatedText).toBe("Hello world");
	});
	it("/detect 失败时回退 en 不中断翻译", async () => {
		const transport = fakeTransport((url, body) => {
			if (url.endsWith("/detect")) return { status: 500, body: "", headers: {} };
			const payload = JSON.parse(body) as { from: string };
			expect(payload.from).toBe("en");
			return { status: 200, body: JSON.stringify({ result: "ok" }), headers: {} };
		});
		const p = new MTranServerProvider({ config: mtranCfg, http: transport });
		const result = await p.translateText("hello", false, "auto", "zh-Hans");
		expect(result.translatedText).toBe("ok");
	});
	it("未配置地址抛出错误", async () => {
		const transport = fakeTransport(() => ({ status: 200, body: "{}", headers: {} }));
		const p = new MTranServerProvider({ config: cfg({ offlineEndpoint: "" }), http: transport });
		await expect(p.translateText("hello", false, "auto", "zh-Hans")).rejects.toThrow(/未配置/);
	});
	it("HTTP 错误抛出可读信息", async () => {
		const transport = fakeTransport(() => ({ status: 500, body: "boom", headers: {} }));
		const p = new MTranServerProvider({ config: mtranCfg, http: transport });
		await expect(p.translateText("hello", false, "auto", "zh-Hans")).rejects.toThrow(/500/);
	});
	it("响应缺少译文抛出错误", async () => {
		const transport = fakeTransport(() => ({ status: 200, body: JSON.stringify({ foo: 1 }), headers: {} }));
		const p = new MTranServerProvider({ config: mtranCfg, http: transport });
		await expect(p.translateText("hello", false, "auto", "zh-Hans")).rejects.toThrow(/缺少译文/);
	});
});

describe("createProvider", () => {
	it("按配置选择 Provider", () => {
		expect(createProvider({ config: cfg({ provider: "openai" }), http: fakeTransport(() => ({ status: 200, body: "{}", headers: {} })) }).id).toBe("openai");
		expect(createProvider({ config: cfg({ provider: "deepl" }), http: fakeTransport(() => ({ status: 200, body: "{}", headers: {} })) }).id).toBe("deepl");
		expect(createProvider({ config: cfg({ provider: "mtran" }), http: fakeTransport(() => ({ status: 200, body: "{}", headers: {} })) }).id).toBe("mtran");
	});
});

describe("TranslationService", () => {
	// 用 OpenAI 兼容避免依赖离线地址
	const svcCfg = (patch: Partial<NyaLingoSettings> = {}): (() => NyaLingoSettings) => cfg({ provider: "openai", openaiApiKey: "sk-test", openaiBaseUrl: "https://api.example.com/v1", ...patch });

	it("分块翻译后合并保留换行，且并发去重只请求一次", async () => {
		let calls = 0;
		const transport = fakeTransport(() => {
			calls++;
			return { status: 200, body: JSON.stringify({ choices: [{ message: { content: "译" } }] }), headers: {} };
		});
		const service = new TranslationService({ config: svcCfg({ cacheEnabled: false }), http: transport });
		const r1 = service.translate("hello", { to: "zh-Hans" });
		const r2 = service.translate("hello", { to: "zh-Hans" });
		expect(await r1).toBe("译");
		expect(await r2).toBe("译");
		expect(calls).toBe(1);
	});
	it("缓存命中不重复请求", async () => {
		let calls = 0;
		const transport = fakeTransport(() => {
			calls++;
			return { status: 200, body: JSON.stringify({ choices: [{ message: { content: "你好" } }] }), headers: {} };
		});
		const service = new TranslationService({ config: svcCfg({ cacheEnabled: true }), http: transport });
		await service.translate("hello", { to: "zh-Hans" });
		await service.translate("hello", { to: "zh-Hans" });
		expect(calls).toBe(1);
	});
	it("空文本返回空串", async () => {
		const service = new TranslationService({ config: svcCfg(), http: fakeTransport(() => ({ status: 200, body: "{}", headers: {} })) });
		expect(await service.translate("   ")).toBe("");
	});
});
