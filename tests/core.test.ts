/**
 * NyaLingo 单测：缓存 LRU、分块、设置归一化、离线探测。
 */
import { describe, it, expect } from "vitest";
import { TranslationCache, translationKey, ITranslationCacheStore } from "../src/cache";
import { splitTranslationChunks, htmlToPlainText } from "../src/text";
import { normalizeSettings, DEFAULT_SETTINGS } from "../src/settings";
import { probeOfflineServer, normalizeEndpoint } from "../src/offline-probe";
import type { HttpTransport, HttpResponse } from "../src/http";

function memoryStore(): ITranslationCacheStore & { data: Record<string, string> } {
	const data: Record<string, string> = {};
	return {
		data,
		load: async () => ({ ...data }),
		save: async (d) => {
			Object.keys(data).forEach((k) => delete data[k]);
			Object.assign(data, d);
		},
	};
}

function fakeTransport(handler: (url: string, body: string) => HttpResponse): HttpTransport {
	return {
		async request(req) {
			return handler(req.url, req.body ?? "");
		},
	};
}

describe("translationKey", () => {
	it("相同文本+语言对+provider 得到相同键", () => {
		expect(translationKey("hello", "auto", "zh-Hans", "mtran")).toBe(translationKey("hello", "auto", "zh-Hans", "mtran"));
	});
	it("不同 provider 得到不同键", () => {
		expect(translationKey("hello", "auto", "zh-Hans", "mtran")).not.toBe(translationKey("hello", "auto", "zh-Hans", "openai"));
	});
});

describe("TranslationCache", () => {
	it("LRU：命中后移到末尾，淘汰最旧", async () => {
		const store = memoryStore();
		const cache = new TranslationCache(store, 2);
		cache.set("a", "1");
		cache.set("b", "2");
		expect(cache.get("a")).toBe("1"); // a 变最新
		cache.set("c", "3"); // 淘汰最旧的 b
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBe("1");
		expect(cache.size()).toBe(2);
	});
	it("持久化后可恢复", async () => {
		const store = memoryStore();
		const cache = new TranslationCache(store, 100);
		cache.set("k", "v");
		await cache.persist();
		const cache2 = new TranslationCache(store, 100);
		await cache2.load();
		expect(cache2.get("k")).toBe("v");
	});
	it("load 失败时回退空缓存不抛错", async () => {
		const cache = new TranslationCache(
			{ load: async () => { throw new Error("boom"); }, save: async () => undefined },
			100
		);
		await expect(cache.load()).resolves.toBeUndefined();
		expect(cache.size()).toBe(0);
	});
});

describe("splitTranslationChunks", () => {
	it("短文本不分块", () => {
		const chunks = splitTranslationChunks("hello world", 100);
		expect(chunks).toEqual([{ text: "hello world", separator: "" }]);
	});
	it("超长单段硬切", () => {
		const chunks = splitTranslationChunks("a".repeat(300), 100);
		expect(chunks.length).toBe(3);
		expect(chunks.map((c) => c.text).join("")).toBe("a".repeat(300));
	});
	it("保留换行分隔符便于还原排版", () => {
		const chunks = splitTranslationChunks("aa\n\nbb", 100);
		expect(chunks.length).toBe(1);
		expect(chunks[0].text).toBe("aa\n\nbb");
	});
});

describe("htmlToPlainText", () => {
	it("剥离标签", () => {
		expect(htmlToPlainText("<p>Hello <b>World</b></p>").trim()).toBe("Hello World");
	});
});

describe("normalizeSettings", () => {
	it("空输入回退默认值", () => {
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});
	it("非法 provider 回退 mtran", () => {
		expect(normalizeSettings({ provider: "bad" }).provider).toBe("mtran");
	});
	it("越界超时被钳制", () => {
		expect(normalizeSettings({ timeoutMs: 999999 }).timeoutMs).toBe(120000);
	});
});

describe("probeOfflineServer", () => {
	it("languages 2xx 判定运行中", async () => {
		const http = fakeTransport((url) => {
			if (url.endsWith("/languages")) return { status: 200, body: JSON.stringify({ languages: [1, 2, 3] }), headers: {} };
			return { status: 404, body: "", headers: {} };
		});
		const r = await probeOfflineServer(http, "http://127.0.0.1:8989/", 1000);
		expect(r.running).toBe(true);
		expect(r.detail).toContain("3 种语言");
	});
	it("空地址返回未填写", async () => {
		const http = fakeTransport(() => ({ status: 404, body: "", headers: {} }));
		const r = await probeOfflineServer(http, "   ", 1000);
		expect(r.running).toBe(false);
		expect(r.error).toContain("未填写");
	});
	it("连接失败返回错误信息", async () => {
		const http: HttpTransport = {
			async request() {
				throw new Error("ECONNREFUSED");
			},
		};
		const r = await probeOfflineServer(http, "http://127.0.0.1:9999", 1000);
		expect(r.running).toBe(false);
		expect(r.error).toContain("ECONNREFUSED");
	});
});

describe("normalizeEndpoint", () => {
	it("去除尾部斜杠", () => {
		expect(normalizeEndpoint("http://a:8989///")).toBe("http://a:8989");
	});
});
