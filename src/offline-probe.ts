/**
 * 离线翻译引擎（MTranServer）探测工具。
 * 纯逻辑 + 注入 HttpTransport，便于单元测试。
 */
import type { HttpTransport } from "./http";

export interface ProbeResult {
	/** 引擎是否可访问（2xx 且响应可解析） */
	running: boolean;
	endpoint: string;
	detail?: string;
	error?: string;
}

/** 规范化地址：去尾部斜杠。 */
export function normalizeEndpoint(endpoint: string): string {
	return endpoint.trim().replace(/\/+$/, "");
}

/**
 * 探测本地离线翻译引擎（MTranServer v4 兼容）。
 *
 * MTranServer v4 的无鉴权探活接口是 GET /health（另有 /version、/__heartbeat__）。
 * 早期实现探测 GET /languages 与 POST /translate，这两个都需要鉴权且 /translate
 * 不支持 "auto" 源语言，容易把"服务其实已启动"误判为未启动，进而重复拉起进程。
 * 最后再退回一次真实翻译请求做端到端确认。
 */
export async function probeOfflineServer(http: HttpTransport, endpoint: string, timeoutMs = 4000): Promise<ProbeResult> {
	const base = normalizeEndpoint(endpoint);
	if (!base) return { running: false, endpoint, error: "未填写地址" };

	// 策略一：无鉴权探活接口
	for (const path of ["/health", "/version"]) {
		try {
			const res = await http.request({ url: `${base}${path}`, method: "GET", timeoutMs });
			if (res.status >= 200 && res.status < 300) {
				return { running: true, endpoint: base, detail: "运行中" };
			}
		} catch {
			/* 尝试下一个 */
		}
	}

	// 策略二：真实翻译一次（"auto" 不受支持，显式用 en -> zh-Hans）
	try {
		const res = await http.request({
			url: `${base}/translate`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from: "en", to: "zh-Hans", text: "ok", html: false }),
			timeoutMs,
		});
		if (res.status >= 200 && res.status < 300) {
			return { running: true, endpoint: base, detail: "运行中（可翻译）" };
		}
		return { running: false, endpoint: base, error: `服务器返回 HTTP ${res.status}` };
	} catch (e) {
		return { running: false, endpoint: base, error: `连接失败：${e instanceof Error ? e.message : String(e)}` };
	}
}
