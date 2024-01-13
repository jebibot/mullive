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

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (!ALLOWED_METHODS.includes(request.method)) {
			return new Response('Method Not Allowed', { status: 405, headers: { Allow: ALLOWED_METHODS.join(', ') } });
		}
		if (url.hostname !== 'multichzzk.tv') {
			return Response.redirect(`https://multichzzk.tv${url.pathname}`, 301);
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

		const stream = url.pathname
			.split('/')
			.map((s) => {
				if (s.startsWith('y:')) {
					return `https://www.youtube.com/embed/${s.slice(2)}`;
				}
				s = s.toLowerCase();
				if (s.match(/^[0-9a-f]{32}$/)) {
					return `https://chzzk.naver.com/live/${s}`;
				} else if (s.match(/^[a-z0-9_]{4,25}$/)) {
					return `https://player.twitch.tv/?channel=${s}&parent=${url.hostname}`;
				} else if (s.startsWith('a:') && s.slice(2).match(/^[a-z0-9]{6,12}$/)) {
					return `https://play.afreecatv.com/${s.slice(2)}/embed`;
				}
			})
			.filter(Boolean);
		const html = `<!DOCTYPE html>
<html lang="ko">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>MultiChzzk.tv</title>
		<link rel="icon" href="/favicon.ico" sizes="32x32">
		<link rel="icon" href="/icon.svg" type="image/svg+xml">
		<link rel="apple-touch-icon" href="/apple-touch-icon.png">
		<link rel="manifest" href="/manifest.webmanifest">
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

			#streams {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				align-content: center;
				justify-content: center;
				width: 100%;
				height: 100%;
				padding: 4px;
				box-sizing: border-box;
			}

			#streams iframe {
				flex-grow: 1;
				aspect-ratio: 16 / 9;
			}
		</style>
	</head>
	<body>
		<div id="streams">${
			stream.length > 0
				? stream
						.map(
							(s) =>
								`
			<iframe
				src=${JSON.stringify(s)}
				frameborder="0"
				scrolling="no"
				allowfullscreen="true"
			></iframe>`,
						)
						.join('')
				: `
			<div>
			<h1>MultiChzzk.tv</h1>
			<div>여러 방송을 함께 볼 수 있습니다.</div>
				<ul>
					<li>치지직 UID</li>
					<li>Twitch 아이디</li>
					<li>a:아프리카TV 아이디</li>
					<li>y:YouTube 영상 아이디</li>
				</ul>
				<div><b>예시:</b> https://multichzzk.tv/abcdef1234567890abcdef1234567890/twitch/a:afreeca/y:youtube</div>
			</div>`
		}
		</div>
		<script type="text/javascript">
			function adjustLayout() {
				const streams = document.querySelectorAll("iframe");
				const n = streams.length;
				const width = window.innerWidth - 8;
				const height = window.innerHeight - 8;

				let bestWidth = 0;
				let bestHeight = 0;
				for (let cols = 1; cols <= n; cols++) {
					const rows = Math.ceil(n / cols);
					let maxWidth = Math.floor(width / cols);
					let maxHeight = Math.floor(height / rows);
					if ((maxWidth * 9) / 16 < maxHeight) {
						maxHeight = (maxWidth * 9) / 16;
					} else {
						maxWidth = (maxHeight * 16) / 9;
					}
					if (maxWidth > bestWidth) {
						bestWidth = maxWidth;
						bestHeight = maxHeight;
					}
				}
				streams.forEach((s) => {
					s.style.flexGrow = 0;
					s.style.width = \`\${Math.floor(bestWidth)}px\`;
					s.style.height = \`\${Math.floor(bestHeight)}px\`;
				});
			}

			adjustLayout();
			window.addEventListener("resize", adjustLayout);
		</script>
	</body>
</html>
`;
		return new Response(isHead ? null : html, {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'content-security-policy':
					"base-uri 'self'; default-src 'self'; script-src 'sha256-2EFxWolO8muS3g594RvfuM+wVNl6AMiTcpnmsHj9hpo='; style-src 'sha256-dfZKFko7NF0OigRBMb2W6/GRvcr3u+TLbQSWTo3OFPc='; frame-src 'self' chzzk.naver.com *.chzzk.naver.com *.twitch.tv *.afreecatv.com www.youtube.com; object-src 'none'",
				'strict-transport-security': 'max-age=31536000; includeSubDomains',
				'x-content-type-options': 'nosniff',
			},
		});
	},
};
