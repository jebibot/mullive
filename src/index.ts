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
	ASSETS: Fetcher;
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
const htmlEnd = `	</body>
</html>
`;

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
			player: `https://play.sooplive.co.kr/${id}/direct${hasExtension ? '?showChat=true' : ''}`,
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
			} else if (/^@[a-zA-Z0-9_\-.%]{3,270}$/.test(id)) {
				channel = id;
			} else if (/^[a-zA-Z0-9]{1,100}$/.test(id)) {
				channel = `c/${id}`;
			} else {
				return;
			}
			const live = await fetch(`https://www.youtube.com/${channel}/live`, { redirect: 'follow' });
			if (!live.ok) {
				live.body?.cancel();
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
					res.body?.cancel();
					return;
				}
				const data = await res.json<{ code: number; content?: { channelName: string } }>();
				if (data.code !== 200) {
					return;
				}
				return data.content?.channelName;
			}
		}
	} catch {}
};

const streamNames = async (stream: Stream[], controller: ReadableStreamDefaultController, nonce: string) => {
	for (let i = 0; i < stream.length; i++) {
		const name = await getName(stream[i]);
		if (name) {
			controller.enqueue(
				encoder.encode(`		<script type="text/javascript" nonce="${nonce}">setName(${i}, ${JSON.stringify(name)});</script>\n`),
			);
		}
	}
	controller.enqueue(encoder.encode(htmlEnd));
	controller.close();
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
		if (stream.length === 0) {
			return env.ASSETS.fetch(request);
		}

		const initialChat = stream.find((s) => hasExtension || !s.extension);
		const nonce = crypto.randomUUID();

		const extensionUrl = /firefox/i.test(navigator.userAgent)
			? 'https://addons.mozilla.org/addon/mullive/'
			: 'https://chromewebstore.google.com/detail/pahcphmhihleneomklgfbbneokhjiaim';

		const html = `<!DOCTYPE html>
<html lang="ko">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="description" content="여러 치지직, 숲(SOOP), 트위치, 유튜브 방송을 함께 볼 수 있습니다." />
		<meta name="keywords" content="Twitch,CHZZK,숲,아프리카TV,AfreecaTV,YouTube,스트리머,streamer,멀티뷰,multiview,multistream" />
		<title>Mul.Live - 멀티뷰</title>
		<link rel="icon" href="/favicon.ico" sizes="32x32" />
		<link rel="icon" href="/icon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
		<link rel="manifest" href="/manifest.webmanifest" />
		<style nonce="${nonce}">
			*,
			*::before,
			*::after {
				box-sizing: border-box;
				font-family: Pretendard;
			}

			select:active,
			select:focus {
				outline: none;
			}

			:root {
				color-scheme: dark;
			}

			a {
				color: white;
				text-decoration: none;
			}

			button {
				background: none;
				border: none;
				cursor: pointer;
				transition: 0.25s;
			}

			button:active,
			button:focus {
				outline: none;
			}

			button:active {
				transform: scale(0.95);
				transition: 0.25s;
			}

			html,
			body {
				margin: 0;
				padding: 0;
				width: 100%;
				height: 100%;
				color: white;
				background: black;
				overflow: hidden;
			}

			hr {
				border: 0;
				height: 1px;
				background-color: #ffffff33;
				margin: 0;
			}

			svg {
				width: 16px;
				height: 16px;
				fill: #ccc;
			}

			.container {
				display: flex;
				position: relative;
				width: 100%;
				height: 100%;
			}

			.button {
				padding: 6px;
				border-radius: 4px;
				text-align: center;
				line-height: 1;
				cursor: pointer;
				transition: 0.25s;
			}

			.button:hover {
  				box-shadow: inset 0px 0px 999px 5px rgba(255, 255, 255, 0.15);
  				transition: 0.15s;
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
				position: relative;
			}

			#chat-select-container{
				display: flex;
				align-items: center;
				margin: 6px;
				gap: 6px;
			}

			#chat-icon {
				width: 16px;
				position: absolute;
				left: 20px;
				height: 16px;
			}


			#chat-select {
				background: #333;
				background-image: url("/assets/chevron-down.svg");
				background-repeat: no-repeat;
				background-position: right 10px center;
				background-size: 14px;
				color: white;
				border: 1px solid #555;
				border-radius: 40px;
				height: 40px;
				padding: 8px 12px 8px 36px;
				width: 100%;
				font-size: 12px;
				-webkit-appearance: none;
				appearance: none;
			}

			#chat-close {
				width: 40px;
				height: 40px;
				display: flex;
				background-color: #555;
				border-radius: 40px;
				justify-content: center;
				align-items: center;
				flex-shrink: 0;
				line-height: 1;
				transition: 0.25s;
			}

			#chat-close:hover {
				background-color: #d13434;
			}

			#chat-close img {
				width: 18px;
				height: 18px;
				outline: none;
			}

			#chat {
				flex-grow: 1;
				width: 100%;
			}

			#fullscreen {
				position: fixed;
				top: 6px;
				right: 48px;
				border-radius: 48px;
				background-color:rgba(0, 0, 0, 0.53);
				border: 1px solid rgba(255, 255, 255, 0.1);
				width: 40px;
				display: flex;
				justify-content: center;
				align-items: center;
				height: 40px;
				transition: opacity 150ms ease-in-out;
				opacity: 1;
				animation: fadeOut 0.5s forwards;
				animation-delay: 4s;
				transition: 0.25s;
			}

			#fullscreen img {
				width: 20px;
				height: 20px;
				margin-bottom: 1px;
				fill: #777;
			}

			#fullscreen:hover {
				opacity: 1 !important;
				transition: 0.25s;
			}
			
			#chat-toggle {
				position: fixed;
				top: 6px;
				right: 6px;
				border-radius: 48px;
				background-color:rgba(0, 0, 0, 0.53);
				border: 1px solid rgba(255, 255, 255, 0.1);
				width: 40px;
				display: flex;
				justify-content: center;
				align-items: center;
				height: 40px;
				transition: opacity 150ms ease-in-out;
			}

			#chat-toggle img {
				width: 20px;
				height: 20px;
				margin-bottom: 1px;
				fill: #777;
			}

			#chat-toggle:hover {
				opacity: 1 !important;
			}

			.button {
				padding: 6px;
				border-radius: 4px;
				text-align: center;
				line-height: 1;
				cursor: pointer;
			}
				
			.box {
				margin-top: 16px;
			}

			.plugin {
				opacity: 0;
				position: fixed;
				bottom: 40px;
				width: 400px;
				left: calc(50% - 200px);
				display: flex;
				align-items: center;
				justify-content: center;
				background-color: rgba(40, 40, 40, 0.5);
				backdrop-filter: blur(8px);
				border: 1px solid #ffffff33;
				border-radius: 32px;
				overflow: hidden;
				margin: 0px auto 0;
				padding: 8px;
				animation: slideInFromBottom 0.75s forwards;
				animation-delay: 5s;
			}

			.plugin-img {
				background-color: rgb(255, 255, 255);
				border-radius: 32px;
				display: flex;
				align-items: center;
				justify-content: center;
				margin-right: 8px;
				padding: 8px;
			}

			.plugin-img img {
				width: 24px;
				height: 24px;
			}

			#plugin-info {
				line-height: 1.5;
				margin-right: 12px;
				flex: 1;
			}

			.plugin-close {
				background-color: #555;
				border-radius: 32px;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 6px;
				cursor: pointer;
			}

			.plugin-close img {
				width: 16px;
				height: 16px;
			}

			.plugin-info-title {
				font-size: 16px;
				font-weight: bold;
			}

			.plugin-info-description {
				font-size: 14px;
				opacity: 0.8;
			}

			#mullive-overlay {
				position: fixed;
				left: calc(50% - 200px);
				bottom: 40px;
				width: 400px;
				height: 100px;
				z-index: 1000;
				background: url("/bg.webp") no-repeat center center;
				display: flex;
				align-items: center;
				justify-content: center;
				border-radius: 120px;
				animation: slideInFromBottom 1s forwards 0.5s, moveBackgroundImage 5s linear infinite, slideOut 1.5s forwards 4.2s;
				overflow: hidden;
				box-shadow: 0 0 30px rgba(0, 0, 0, 0.2);
				opacity: 0;
				gap: 20px;
			}

			#mullive-overlay .logo {
				width: 160px;
				animation: slideInFromBottom 0.75s forwards 0.25s, slideOut 2s forwards 4.1s;
				opacity: 0;
			}

			#mullive-overlay .argo {
				width: 80px;
				animation: slideInFromBottom 0.75s forwards 0.5s, slideOut 0.75s forwards 4s;
				opacity: 0;
			}

			@keyframes moveBackgroundImage {
				0% {
					background-position: 100% 100%;
				}
				100% {
					background-position: 20% 20%;
				}	
			
			}

			@keyframes slideOut {
				0% {
					transform: translateY(0);
					opacity: 1;
				}
				100% {
					transform: translateY(150%);
					opacity: 0;
				}
			}

			@keyframes fadeOut {
				0% {
					opacity: 1;
				}
				100% {
					opacity: 0;
				}
			}

			@keyframes slideInFromBottom {
				0% {
					opacity: 0;
					transform: translateY(150%);
				}
				100% {
					opacity: 1;
					transform: translateY(0);
				}
			}


			#chat-container:has(#chat[src="about:blank"]),
			#chat-container:has(#chat[src="about:blank"]) + #chat-toggle .close,
			#chat-container:not(:has(#chat[src="about:blank"])) + #chat-toggle .open {
				display: none;
			}

			#overlay {
				display: none;
			}

			#overlay-close {
				margin-left: auto;
			}

			#overlay-button {
				margin: 12px 16px 0;
				background-color: #555;
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
						: `<div class="box">스트림 없음</div>`
				}
			</div>
			<div id="chat-container">
				<div id="chat-select-container">
					<img src="/assets/chat.svg" alt="채팅" id="chat-icon" />
					<select id="chat-select" aria-label="채팅">
						${stream.map((s) => `<option value=${JSON.stringify(s.chat)}${hasExtension || !s.extension ? `>${s.id}` : ` disabled>${s.id} [확장 프로그램 필요]`}</option>`).join('\n\t\t\t\t\t')}
					</select>
					<button id="chat-close" class="button">
						<img src="/assets/xmark.svg" alt="채팅닫기" />
					</button>
				</div>
				<iframe src=${JSON.stringify((!initialChat?.extension && initialChat?.chat) || 'about:blank')} frameborder="0" scrolling="no" id="chat"></iframe>
			</div>
		</div>
		<button id="fullscreen" class="button">
			<img src="/assets/pointing-out.svg" alt="전체화면" />
		</button>
		<button id="chat-toggle" class="button">
			<img src="/assets/chat.svg" alt="채팅" />
		</button>
		<div id="overlay">
			<div class="plugin">
				<a class="plugin-img" target="_blank" rel="noopener noreferrer" href="${extensionUrl}">
					<img src="/plugin.png" />
				</a>
				<a class="plugin-info" id="plugin-info target="_blank" rel="noopener noreferrer" href="${extensionUrl}">
					<div class="plugin-info-title">mul.live PLUS</div>
					<div class="plugin-info-description">설치 후 채팅 등 로그인 기능을 사용할 수 있습니다</div>
				</a>
				<div class="plugin-close" id="overlay-close">
					<img src="/assets/xmark.svg" alt="닫기" />
				</div>
			</div>
		</div>
		<div id="mullive-overlay">
				<img class="logo" src="/mullive.svg" alt="Mul.Live" />
				<img class="argo" src="/argo.png" alt="Argo" />
		</div>
		<script type="text/javascript" nonce="${nonce}">
			let init = true;
			const hasExtension = ${JSON.stringify(hasExtension)};

			const streams = document.getElementById("streams");
			const chat = document.getElementById("chat");
			const chatSelect = document.getElementById("chat-select");
			const chatToggle = document.getElementById("chat-toggle");
			const chatClose = document.getElementById("chat-close");

			const fullScreenToggle = document.getElementById("fullscreen");

			const overlay = document.getElementById("overlay");
			const overlayButton = document.getElementById("overlay-button");
			const overlayClose = document.getElementById("overlay-close");
			const overlayContent = document.getElementById("overlay-content");
			const iframes = streams.querySelectorAll("iframe");
			const n = iframes.length;

			function toggleFullScreen() {
				if (!document.fullscreenElement) {
					document.documentElement.requestFullscreen();
				} else {
					document.exitFullscreen();
				}
			}

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

			function closeOverlay() {
				overlay.style.display = "none";
				localStorage.setItem("seen-overlay", "true");
			}

			function showRefreshOverlay() {
				overlayContent.textContent = "로그인 후 채팅을 새로고침 해주세요.";
				overlayButton.textContent = "새로고침";
				overlay.style.display = "flex";
			}

			fullScreenToggle.addEventListener("click", toggleFullScreen);

			adjustLayout();
			window.addEventListener("resize", adjustLayout);
			chat.addEventListener("load", adjustLayout);
			chatSelect.addEventListener("change", (e) => {
				chat.src = e.target.value;
			});

			chatClose.addEventListener("click", () => {
				chat.src = "about:blank";
				chatToggle.style.display = "flex";
				fullScreenToggle.style.display = "flex";
			});

			chatToggle.addEventListener("click", () => {
				chat.src = chat.src !== "about:blank" ? "about:blank" : chatSelect.value;

				if (chat.src !== "about:blank") {
					chatToggle.style.display = "none";
					fullScreenToggle.style.display = "none";
				}
				else{
					chatToggle.style.display = "flex";
					fullScreenToggle.style.display = "flex";
				}
			});

			setTimeout(() => {
				chatToggle.style.opacity = 0;
			}, 10000);

			overlayClose.addEventListener("click", closeOverlay);
			overlayButton?.addEventListener("click", () => {
				switch (overlayButton?.textContent) {
					case "확장 프로그램 설치":
						window.open(extensionUrl);
						break;
					case "새로고침":
						chat.src = chatSelect.value;
						break;
					default:
						break;
				}
				closeOverlay();
			});
			
			if (!hasExtension && n && localStorage.getItem("seen-overlay") !== "true") {
				overlay.style.display = "flex";
			}

			document.addEventListener("securitypolicyviolation", (e) => {
				if (e.blockedURI === "https://nid.naver.com") {
					window.open("https://nid.naver.com/nidlogin.login");
					showRefreshOverlay();
				}
			});

			window.addEventListener("message", (e) => {
				if (e.origin === "https://play.sooplive.co.kr") {
					switch (e.data.cmd) {
						case "PonReady":
							if (init && hasExtension && e.source === iframes[0].contentWindow) {
								init = false;
								chat.src = chatSelect.value;
							}
							break;
						case "PupdateBroadInfo":
							setName(Array.prototype.findIndex.call(iframes, (f) => e.source === f.contentWindow), e.data.data.nick);
							break;
						case "showRefreshOverlay":
							showRefreshOverlay();
							break;
					}
				}
			});
		</script>
`;
		return new Response(
			stream.some((s) => s.type === 'chzzk' || s.type === 'youtube')
				? new ReadableStream({
						start(controller) {
							controller.enqueue(encoder.encode(html));
							streamNames(stream, controller, nonce);
						},
						cancel(reason) {
							console.log('Stream cancelled:', reason);
						},
					})
				: html + htmlEnd,
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
