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
	STATIC: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

const ALLOWED_METHODS = ['OPTIONS', 'GET', 'HEAD'];

const isNotUndefined = <T>(x: T | undefined): x is T => x !== undefined;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (!ALLOWED_METHODS.includes(request.method)) {
			return new Response('Method Not Allowed', { status: 405, headers: { Allow: ALLOWED_METHODS.join(', ') } });
		}
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: { Allow: ALLOWED_METHODS.join(', ') } });
		}
		const isHead = request.method === 'HEAD';

		if (url.pathname.includes('.')) {
			const objectName = url.pathname.slice(1);
			const object = isHead
				? await env.STATIC.head(objectName)
				: await env.STATIC.get(objectName, {
						range: request.headers,
						onlyIf: request.headers,
					});
			if (object === null) {
				return new Response('Not Found', { status: 404 });
			}

			const headers = new Headers();
			object.writeHttpMetadata(headers);
			headers.set('etag', object.httpEtag);
			if (object.range != null) {
				// @ts-expect-error offset and length are always present
				headers.set('content-range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
			}
			const body = 'body' in object ? (object as R2ObjectBody).body : null;
			const status = isHead || body ? (request.headers.get('range') !== null ? 206 : 200) : 304;
			return new Response(body, { headers, status });
		}

		const stream = (
			await Promise.all(
				url.pathname.split('/').map(async (s) => {
					if (/^[0-9a-f]{32}$/i.test(s)) {
						return { name: s.substring(0, 6), player: `https://chzzk.naver.com/live/${s}`, chat: `https://chzzk.naver.com/live/${s}/chat` };
					} else if (/^[a-z0-9_]{4,25}$/i.test(s)) {
						return {
							name: s,
							player: `https://player.twitch.tv/?channel=${s}&parent=${url.hostname}`,
							chat: `https://www.twitch.tv/embed/${s}/chat?darkpopout&parent=${url.hostname}`,
						};
					} else if (/^a:[a-z0-9]{3,12}$/i.test(s)) {
						return { player: `https://play.afreecatv.com/${s.slice(2)}/embed` };
					} else if (/^ac:[a-z0-9]{3,12}$/i.test(s)) {
						return { player: `https://play.afreecatv.com/${s.slice(3)}/embed?showChat=true` };
					} else if (/^s:[a-z0-9]{3,12}$/i.test(s)) {
						return { player: `https://play.sooplive.co.kr/${s.slice(2)}/embed` };
					} else if (/^sc:[a-z0-9]{3,12}$/i.test(s)) {
						return { player: `https://play.sooplive.co.kr/${s.slice(3)}/embed?showChat=true` };
					} else if (s.startsWith('y:')) {
						s = s.slice(2);
						if (!/^[a-zA-Z0-9_\-]{11}$/.test(s)) {
							let channel = '';
							if (/^UC[a-zA-Z0-9_\-]{22}$/.test(s)) {
								channel = `channel/${s}`;
							} else if (/^@[a-zA-Z0-9_\-]{3,30}$/.test(s)) {
								channel = s;
							} else if (/^[a-zA-Z0-9]{1,100}$/.test(s)) {
								channel = `c/${s}`;
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
							s = match[1];
						}
						return {
							name: s,
							player: `https://www.youtube.com/embed/${s}?autoplay=1`,
							chat: `https://www.youtube.com/live_chat?v=${s}&embed_domain=${url.hostname}&dark_theme=1`,
						};
					}
				}),
			)
		).filter(isNotUndefined);
		const extension = request.headers.get('user-agent')?.includes('Firefox')
			? 'https://addons.mozilla.org/addon/mullive/'
			: 'https://chromewebstore.google.com/detail/pahcphmhihleneomklgfbbneokhjiaim';
		const chats = stream.filter((s) => s.chat);
		chats.push({ name: '로그인', player: '', chat: extension });
		chats.push({ name: '닫기', player: '', chat: 'about:blank' });
		const html = `<!DOCTYPE html>
<html lang="ko">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="description" content="여러 치지직, 트위치, SOOP, 유튜브 방송을 함께 볼 수 있습니다." />
		<meta name="keywords" content="Twitch,CHZZK,숲,아프리카TV,AfreecaTV,YouTube,스트리머,streamer,BJ,멀티뷰,multiview,multistream" />
		<title>Mul.Live - 멀티뷰</title>
		<link rel="icon" href="/favicon.ico" sizes="32x32" />
		<link rel="icon" href="/icon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="manifest" href="/manifest.webmanifest" />
		<style>
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

			a {
				color: #ddd;
				text-decoration: none;
			}

			a:hover {
				color: #fff;
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

			#chat {
				width: 350px;
				height: 100%;
			}

			#chats {
				position: fixed;
				top: 0;
				right: 0;
				margin: 4px;
				padding: 4px;
				border-radius: 4px;
				background-color: rgba(0, 0, 0, 0.8);
				transition: opacity 150ms ease-in-out;
			}

			#chats:hover {
				opacity: 1 !important;
			}

			#chats a:not(:last-child)::after {
				content: " | ";
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
								.map((s) => `<iframe src=${JSON.stringify(s!.player)} frameborder="0" scrolling="no" allowfullscreen="true"></iframe>`)
								.join('\n\t\t\t\t')
						: `<div>
					<h1>Mul.Live - 멀티뷰</h1>
					<div>여러 치지직, 트위치, SOOP, 유튜브 방송을 함께 볼 수 있습니다.</div>
					<ul>
						<li>치지직 UID</li>
						<li>Twitch 아이디</li>
						<li>
						  s:SOOP 아이디
							<ul><li>sc:채팅창 등 사용 가능</li></ul>
						</li>
						<li>y:YouTube 핸들, 맞춤 URL, 채널 또는 영상 ID</li>
					</ul>
					<div><b>예시:</b> https://mul.live/abcdef1234567890abcdef1234567890/twitch/s:soop/y:@youtube</div>
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
			<iframe src=${chats.length > 2 ? JSON.stringify(chats[0].chat) : 'about:blank'} frameborder="0" scrolling="no" id="chat" name="chat"></iframe>
		</div>
		<div id="chats">
			${chats.map((s) => `<a href=${JSON.stringify(s.chat)} target="${s.name === '로그인' ? '_blank' : 'chat'}">${s!.name}</a>`).join('\n\t\t\t')}
		</div>
		<script type="text/javascript">
		  const streams = document.getElementById("streams");
		  const chat = document.getElementById("chat");
			const frames = streams.querySelectorAll("iframe");
			const n = frames.length;
			function adjustLayout() {
				let isChatOpen = true;
				try {
					isChatOpen = window.frames.chat.location.href !== "about:blank";
				} catch {}
				chat.style.display = isChatOpen ? "block" : "none";

				const width = window.innerWidth - 8 - (isChatOpen ? 350 : 0);
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
				frames.forEach((f) => {
					f.style.flexGrow = 0;
					f.style.width = \`\${bestWidth}px\`;
					f.style.height = \`\${bestHeight}px\`;
				});
			}

			adjustLayout();
			window.addEventListener("resize", adjustLayout);
			chat.addEventListener("load", adjustLayout);
			document.addEventListener('securitypolicyviolation', (e) => {
				if (e.blockedURI === 'https://nid.naver.com') {
					window.open('https://nid.naver.com/nidlogin.login');
				}
			});
			setTimeout(() => {
				document.getElementById("chats").style.opacity = 0;
			}, 10000);
		</script>
	</body>
</html>
`;
		return new Response(isHead ? null : html, {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'content-security-policy':
					"base-uri 'self'; default-src 'self'; script-src 'sha256-pWW0O5dSvnf32VbLWTJzwENlQgDbJL53vzCCbv4x7bQ='; style-src 'sha256-HoW/pdbTx+4VB2ty/pnKRb9gvA0m5LInv3olnNbu98M='; frame-src 'self' chzzk.naver.com *.chzzk.naver.com *.twitch.tv *.afreecatv.com *.sooplive.co.kr www.youtube.com; object-src 'none'",
				'strict-transport-security': 'max-age=31536000; includeSubDomains',
				'x-content-type-options': 'nosniff',
			},
		});
	},
};
