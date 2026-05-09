export function renderFinderChart(
  canvas: HTMLCanvasElement,
  targetRA: number,
  targetDec: number,
  label: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const fov = 5; // degrees field of view

  // Background
  ctx.fillStyle = "#0a0e1a";
  ctx.fillRect(0, 0, w, h);

  // Grid circles
  ctx.strokeStyle = "#1c2340";
  ctx.lineWidth = 0.5;
  for (let r = 1; r <= 4; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r / fov) * (w / 2), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshair
  ctx.strokeStyle = "#2a3050";
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();

  // FOV label
  ctx.fillStyle = "#8892a8";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${fov}° FOV`, 8, h - 8);

  // Cardinal directions
  ctx.fillStyle = "#8892a8";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, 14);
  ctx.fillText("S", cx, h - 4);
  ctx.textAlign = "left";
  ctx.fillText("E", 4, cy + 4);
  ctx.textAlign = "right";
  ctx.fillText("W", w - 4, cy + 4);

  // Target marker
  ctx.fillStyle = "#4fc3f7";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  // Target crosshair
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx - 6, cy);
  ctx.moveTo(cx + 6, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy - 6);
  ctx.moveTo(cx, cy + 6);
  ctx.lineTo(cx, cy + 12);
  ctx.stroke();

  // Label
  ctx.fillStyle = "#e0e6f0";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy + 24);

  // Coordinates
  ctx.fillStyle = "#8892a8";
  ctx.font = "10px sans-serif";
  ctx.fillText(
    `RA ${targetRA.toFixed(2)}h  Dec ${targetDec >= 0 ? "+" : ""}${targetDec.toFixed(1)}°`,
    cx,
    cy + 38,
  );
}
