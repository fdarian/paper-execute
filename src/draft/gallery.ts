export const galleryHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>draft</title>
<style>
	* { box-sizing: border-box; }
	body { margin: 0; padding: 24px; background: #1c1c1e; color: #e5e5e7; font: 13px/1.4 system-ui, sans-serif; }
	#frames { display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; }
	figure { margin: 0; }
	figcaption { margin-bottom: 8px; color: #98989d; font-family: ui-monospace, monospace; }
	.stage { position: relative; overflow: hidden; background: #fff; border-radius: 4px; }
	iframe { position: absolute; top: 0; left: 0; border: 0; transform-origin: 0 0; background: #fff; }
	#empty { color: #98989d; }
</style>
</head>
<body>
<div id="frames"></div>
<p id="empty" hidden>No frames yet. Write an .html file in the project folder.</p>
<script>
	const container = document.getElementById("frames");
	const empty = document.getElementById("empty");
	const maxFigureWidth = 960;
	let known = "";
	let fits = [];

	function build(frames) {
		container.replaceChildren();
		fits = [];
		empty.hidden = frames.length > 0;
		for (const frame of frames) {
			const figure = document.createElement("figure");
			figure.style.width = Math.min(frame.width, maxFigureWidth) + "px";
			const caption = document.createElement("figcaption");
			caption.textContent = frame.path + " (" + frame.width + "px)";
			const stage = document.createElement("div");
			stage.className = "stage";
			const iframe = document.createElement("iframe");
			iframe.style.width = frame.width + "px";
			iframe.src = "/" + frame.path.split("/").map(encodeURIComponent).join("/");
			const fit = () => {
				const document_ = iframe.contentDocument;
				if (document_ === null) return;
				const height = document_.documentElement.scrollHeight;
				const scale = Math.min(1, stage.clientWidth / frame.width);
				iframe.style.height = height + "px";
				iframe.style.transform = "scale(" + scale + ")";
				stage.style.height = height * scale + "px";
			};
			iframe.addEventListener("load", fit);
			fits.push(fit);
			stage.append(iframe);
			figure.append(caption, stage);
			container.append(figure);
		}
	}

	async function refresh() {
		const response = await fetch("/__frames");
		const frames = await response.json();
		const key = JSON.stringify(frames);
		if (key !== known) {
			known = key;
			build(frames);
			return;
		}
		for (const iframe of container.querySelectorAll("iframe")) iframe.contentWindow.location.reload();
	}

	window.addEventListener("resize", () => { for (const fit of fits) fit(); });
	new EventSource("/__events").addEventListener("change", refresh);
	refresh();
</script>
</body>
</html>
`;
