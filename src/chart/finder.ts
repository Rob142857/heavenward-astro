export interface FieldStar {
  ra: number;
  dec: number;
  magnitude: number;
  name?: string;
}

export function renderFinderChart(
  canvas: HTMLCanvasElement,
  targetRA: number,
  targetDec: number,
  label: string,
  fieldStars?: FieldStar[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const scale = w / 400; // account for HiDPI
  const cx = w / 2;
  const cy = h / 2;
  const fov = 5; // degrees field of view

  // Background
  ctx.fillStyle = "#0a0e1a";
  ctx.fillRect(0, 0, w, h);

  // Grid circles (1° increments)
  ctx.strokeStyle = "#1c2340";
  ctx.lineWidth = 0.5 * scale;
  for (let r = 1; r <= 4; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r / fov) * (w / 2), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshair
  ctx.strokeStyle = "#2a3050";
  ctx.lineWidth = 0.5 * scale;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();

  // FOV label
  ctx.fillStyle = "#8892a8";
  ctx.font = `${11 * scale}px sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`${fov}° FOV`, 8 * scale, h - 8 * scale);

  // Cardinal directions
  ctx.fillStyle = "#8892a8";
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("N", cx, 14 * scale);
  ctx.fillText("S", cx, h - 4 * scale);
  ctx.textAlign = "left";
  ctx.fillText("E", 4 * scale, cy + 4 * scale);
  ctx.textAlign = "right";
  ctx.fillText("W", w - 4 * scale, cy + 4 * scale);

  // Field stars
  if (fieldStars) {
    const cosDec = Math.cos((targetDec * Math.PI) / 180);
    for (const star of fieldStars) {
      const dRa = (star.ra - targetRA) * 15 * cosDec; // degrees
      const dDec = star.dec - targetDec; // degrees
      const sx = cx - (dRa / fov) * w; // E is left in sky
      const sy = cy - (dDec / fov) * h;
      if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
      // Size by magnitude: brighter = bigger (mag 0→4px, mag 6→1px)
      const r = Math.max(1, (6.5 - star.magnitude) * 0.7) * scale;
      // Color: warm for low mag, dim for high
      const alpha = Math.max(0.3, 1 - star.magnitude / 7);
      ctx.fillStyle = `rgba(220, 220, 240, ${alpha})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      // Label bright stars
      if (star.name && star.magnitude < 4) {
        ctx.fillStyle = `rgba(180, 190, 210, ${alpha})`;
        ctx.font = `${9 * scale}px sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(star.name, sx + r + 2 * scale, sy + 3 * scale);
      }
    }
  }

  // Target marker
  ctx.fillStyle = "#4fc3f7";
  ctx.beginPath();
  ctx.arc(cx, cy, 5 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Target crosshair
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - 12 * scale, cy);
  ctx.lineTo(cx - 6 * scale, cy);
  ctx.moveTo(cx + 6 * scale, cy);
  ctx.lineTo(cx + 12 * scale, cy);
  ctx.moveTo(cx, cy - 12 * scale);
  ctx.lineTo(cx, cy - 6 * scale);
  ctx.moveTo(cx, cy + 6 * scale);
  ctx.lineTo(cx, cy + 12 * scale);
  ctx.stroke();

  // Label
  ctx.fillStyle = "#e0e6f0";
  ctx.font = `${13 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy + 24 * scale);

  // Coordinates
  ctx.fillStyle = "#8892a8";
  ctx.font = `${10 * scale}px sans-serif`;
  ctx.fillText(
    `RA ${targetRA.toFixed(2)}h  Dec ${targetDec >= 0 ? "+" : ""}${targetDec.toFixed(1)}°`,
    cx,
    cy + 38 * scale,
  );
}
