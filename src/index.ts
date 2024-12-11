/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// STATIC: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

interface Stream {
	type: 'chzzk' | 'twitch' | 'soop' | 'youtube';
	id: string;
	/** Not XSS-safe */
	name?: string;
	player: string;
	chat: string;
	extension?: boolean;
}

const ALLOWED_METHODS = ['OPTIONS', 'GET', 'HEAD'];

const encoder = new TextEncoder();
const isNotUndefined = <T>(x: T | undefined): x is T => x !== undefined;

const parseStream = async (id: string, parent: string, hasExtension: boolean): Promise<Stream | undefined> => {
	if (/^[0-9a-f]{32}$/i.test(id)) {
		return {
			type: 'chzzk',
			id,
			player: `https://chzzk.naver.com/live/${id}`,
			chat: `https://chzzk.naver.com/live/${id}/chat`,
		};
	} else if (/^t:[a-z0-9_]{4,25}$/i.test(id)) {
		id = id.slice(2);
		return {
			type: 'twitch',
			id,
			player: `https://player.twitch.tv/?channel=${id}&parent=${parent}`,
			chat: `https://www.twitch.tv/embed/${id}/chat?darkpopout&parent=${parent}`,
		};
	} else if (/^(?:[as]c?:)?[a-z0-9]{3,12}$/i.test(id)) {
		id = id.split(':').pop()!;
		return {
			type: 'soop',
			id,
			player: `https://play.sooplive.co.kr/${id}/embed${hasExtension ? '?showChat=true' : ''}`,
			chat: `https://play.sooplive.co.kr/${id}?vtype=chat`,
			extension: true,
		};
	} else if (id.startsWith('y:')) {
		id = id.slice(2);
		let name;
		if (!/^[a-zA-Z0-9_\-]{11}$/.test(id)) {
			let channel = '';
			if (/^UC[a-zA-Z0-9_\-]{22}$/.test(id)) {
				channel = `channel/${id}`;
			} else if (/^@[a-zA-Z0-9_\-]{3,30}$/.test(id)) {
				channel = id;
			} else if (/^[a-zA-Z0-9]{1,100}$/.test(id)) {
				channel = `c/${id}`;
			} else {
				return;
			}
			const live = await fetch(`https://www.youtube.com/${channel}/live`, { redirect: 'follow' });
			if (!live.ok) {
				return;
			}
			const html = await live.text();
			const match = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_\-]{11})"/);
			if (!match) {
				return;
			}
			id = match[1];

			const match2 = html.match(/"author":"([^"]+)"/);
			if (match2) {
				name = match2[1];
			}
		}
		return {
			type: 'youtube',
			id,
			name,
			player: `https://www.youtube.com/embed/${id}?autoplay=1`,
			chat: `https://www.youtube.com/live_chat?v=${id}&embed_domain=${parent}&dark_theme=1`,
		};
	}
};

const getName = async (s: Stream) => {
	if (s.name) {
		return s.name;
	}
	try {
		switch (s.type) {
			case 'chzzk': {
				const res = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${s.id}`);
				if (!res.ok) {
					return;
				}
				const data = await res.json<{ code: number; content?: { channelName: string } }>();
				if (data.code !== 200) {
					return;
				}
				return data.content?.channelName;
			}
			case 'soop': {
				const res = await fetch(`https://st.sooplive.co.kr/api/get_station_status.php?szBjId=${s.id}`);
				if (!res.ok) {
					return;
				}
				const data = await res.json<{ RESULT: number; DATA?: { user_nick: string } }>();
				if (data.RESULT !== 1) {
					return;
				}
				return data.DATA?.user_nick;
			}
		}
	} catch {}
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (!ALLOWED_METHODS.includes(request.method)) {
			return new Response('Method Not Allowed', { status: 405, headers: { Allow: ALLOWED_METHODS.join(', ') } });
		}
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: { Allow: ALLOWED_METHODS.join(', ') } });
		}

		const hasExtension = request.headers.has('x-has-extension');
		const parts = url.pathname.split('/');
		const stream = (await Promise.all(parts.map((s) => parseStream(s, url.hostname, hasExtension)))).filter(isNotUndefined);
		const extension = request.headers.get('user-agent')?.includes('Firefox')
			? 'https://addons.mozilla.org/addon/mullive/'
			: 'https://chromewebstore.google.com/detail/pahcphmhihleneomklgfbbneokhjiaim';
		const initialChat = stream.find((s) => !s.extension);
		const nonce = crypto.randomUUID();
		const html = `<!DOCTYPE html>
<html lang="ko">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="description" content="여러 치지직, SOOP, 트위치, 유튜브 방송을 함께 볼 수 있습니다." />
		<meta name="keywords" content="Twitch,CHZZK,숲,아프리카TV,AfreecaTV,YouTube,스트리머,streamer,멀티뷰,multiview,multistream" />
		<title>Mul.Live - 멀티뷰</title>
		<link rel="icon" href="/favicon.ico" sizes="32x32" />
		<link rel="icon" href="/icon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="manifest" href="/manifest.webmanifest" />
		<style nonce="${nonce}">
			:root {
				color-scheme: dark;
			}

			html,
			body {
				margin: 0;
				padding: 0;
				width: 100%;
				height: 100%;
				color: white;
				background-color: black;
				overflow: hidden;
			}

			.container {
				display: flex;
				width: 100%;
				height: 100%;
			}

			#streams {
				display: flex;
				flex-wrap: wrap;
				flex-grow: 1;
				align-items: center;
				align-content: center;
				justify-content: center;
				width: min-content;
				height: 100%;
			}

			#streams iframe {
				flex-grow: 1;
				aspect-ratio: 16 / 9;
			}

			#chat-container {
				display: flex;
				flex-direction: column;
				width: 350px;
				height: 100%;
			}

			#chat-container:has(#chat[src="about:blank"]) {
				display: none;
			}

			#chat-select {
				margin: 4px;
				margin-right: 32px;
				padding: 2px;
			}

			#chat {
				flex-grow: 1;
				width: 100%;
			}

			#chat-toggle {
				position: fixed;
				top: 0;
				right: 0;
				padding: 6px;
				border-bottom-left-radius: 8px;
				line-height: 1;
				background-color: #333;
				cursor: pointer;
			}

			#chat-toggle svg {
				width: 16px;
				height: 16px;
				fill: #777;
			}

			#chat-toggle:hover {
				background-color: #555;
			}

			#chat-toggle:hover svg {
				fill: #999;
			}

			.box {
				margin-top: 16px;
			}
		</style>
	</head>
	<body>
		<div class="container">
			<div id="streams">
				${
					stream.length > 0
						? stream
								.map(
									(s) =>
										`<iframe src=${JSON.stringify(s.player)} name=${JSON.stringify(s.id)} frameborder="0" scrolling="no" allowfullscreen="true"></iframe>`,
								)
								.join('\n\t\t\t\t')
						: `<div>
					<h1>Mul.Live - 멀티뷰</h1>
					<div>여러 치지직, SOOP, 트위치, 유튜브 방송을 함께 볼 수 있습니다.</div>
					<div>다음을 /로 구분하여 주소 뒤에 붙여주세요.</div>
					<ul>
						<li>치지직 UID</li>
						<li>SOOP 아이디</li>
						<li>t:Twitch 아이디</li>
						<li>y:YouTube 핸들, 맞춤 URL, 채널 또는 영상 ID</li>
					</ul>
					<div><b>예시:</b> https://mul.live/abcdef1234567890abcdef1234567890/soop/t:twitch/y:@youtube</div>
					<div class="box"><a href="${extension}" target="_blank"><u>Mul.Live Plus 확장프로그램</u></a>을 설치하면 채팅 등 로그인 기능을 사용할 수 있습니다.</div>
					<div class="box">
						<a href="https://www.chz.app/" target="_blank">치즈.앱</a> |
						<a href="https://github.com/jebibot/mullive" target="_blank">GitHub</a> |
						<a href="https://discord.gg/9kq3UNKAkz" target="_blank">Discord</a> |
						<a href="https://www.chz.app/privacy" target="_blank">개인정보처리방침</a>
					</div>
				</div>`
				}
			</div>
			<div id="chat-container">
				<select id="chat-select">
					${stream.map((s) => `<option value=${JSON.stringify(s.chat)}${s.extension && !hasExtension ? ` disabled>${s.id} [확장 프로그램 필요]` : `${s === initialChat ? ' selected' : ''}>${s.id}`}</option>`).join('\n\t\t\t\t\t')}
				</select>
				<iframe src=${JSON.stringify(initialChat?.chat || 'about:blank')} frameborder="0" scrolling="no" id="chat"></iframe>
			</div>
		</div>
		<div id="chat-toggle">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free 6.7.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2024 Fonticons, Inc.--><path d="M512 240c0 114.9-114.6 208-256 208c-37.1 0-72.3-6.4-104.1-17.9c-11.9 8.7-31.3 20.6-54.3 30.6C73.6 471.1 44.7 480 16 480c-6.5 0-12.3-3.9-14.8-9.9c-2.5-6-1.1-12.8 3.4-17.4c0 0 0 0 0 0s0 0 0 0s0 0 0 0c0 0 0 0 0 0l.3-.3c.3-.3 .7-.7 1.3-1.4c1.1-1.2 2.8-3.1 4.9-5.7c4.1-5 9.6-12.4 15.2-21.6c10-16.6 19.5-38.4 21.4-62.9C17.7 326.8 0 285.1 0 240C0 125.1 114.6 32 256 32s256 93.1 256 208z"/></svg>
		</div>
		<script type="text/javascript" nonce="${nonce}">
			const streams = document.getElementById("streams");
			const chat = document.getElementById("chat");
			const chatSelect = document.getElementById("chat-select");
			const chatToggle = document.getElementById("chat-toggle");
			const iframes = streams.querySelectorAll("iframe");
			const n = iframes.length;
			function adjustLayout() {
				const width = window.innerWidth - 8 - (chat.src !== "about:blank" ? 350 : 0);
				const height = window.innerHeight - 8;

				let bestWidth = 0;
				let bestHeight = 0;
				for (let cols = 1; cols <= n; cols++) {
					const rows = Math.ceil(n / cols);
					let maxWidth = Math.floor(width / cols);
					let maxHeight = Math.floor(height / rows);
					if ((maxWidth * 9) / 16 < maxHeight) {
						maxHeight = Math.floor((maxWidth * 9) / 16);
					} else {
						maxWidth = Math.floor((maxHeight * 16) / 9);
					}
					if (maxWidth > bestWidth) {
						bestWidth = maxWidth;
						bestHeight = maxHeight;
					}
				}
				iframes.forEach((f) => {
					f.style.flexGrow = "0";
					f.style.width = \`\${bestWidth}px\`;
					f.style.height = \`\${bestHeight}px\`;
				});
			}

			function setName(i, name) {
				const option = chatSelect.children[i];
				option.textContent = option.disabled ? \`\${name} [확장 프로그램 필요]\` : name;
			}

			adjustLayout();
			window.addEventListener("resize", adjustLayout);
			chat.addEventListener("load", adjustLayout);
			chatSelect.addEventListener("change", (e) => {
				chat.src = e.target.value;
			})
			chatToggle.addEventListener("click", () => {
				chat.src = chat.src !== "about:blank" ? "about:blank" : chatSelect.value;
			});

			document.addEventListener('securitypolicyviolation', (e) => {
				if (e.blockedURI === 'https://nid.naver.com') {
					window.open('https://nid.naver.com/nidlogin.login');
				}
			});
		</script>
`;
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode(html));
					(async () => {
						for (let i = 0; i < stream.length; i++) {
							const name = await getName(stream[i]);
							if (name) {
								controller.enqueue(
									encoder.encode(`		<script type="text/javascript" nonce="${nonce}">setName(${i}, ${JSON.stringify(name)});</script>\n`),
								);
							}
						}
						controller.enqueue(
							encoder.encode(`	</body>
</html>
`),
						);
						controller.close();
					})();
				},
				cancel(reason) {
					console.log('Stream cancelled:', reason);
				},
			}),
			{
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'content-security-policy': `base-uri 'self'; default-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src 'self' chzzk.naver.com *.chzzk.naver.com *.twitch.tv *.sooplive.co.kr www.youtube.com; object-src 'none'`,
					'strict-transport-security': 'max-age=31536000; includeSubDomains',
					'x-accel-buffering': 'no',
					'x-content-type-options': 'nosniff',
				},
			},
		);
	},
};
