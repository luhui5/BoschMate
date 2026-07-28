/**
 * 从源 PNG 生成 YourMate 客户端图标（所有平台尺寸）。
 * 源图需为正方形（1024×1024），如果不是则自动居中裁剪填充。
 * 用法: node scripts/generate-icon.mjs [source.png]
 * 默认源文件: C:\Users\luhui\Downloads\ChatGPT Image 2026年7月28日 20_59_06.png
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const srcPath = resolve(process.argv[2] || 'C:\\Users\\luhui\\Downloads\\ChatGPT Image 2026年7月28日 20_59_06.png');
const outPng  = resolve('src-tauri/icons/icon.png');

const SIZE = 1024;
const SCALE = 2; // 放大2倍（保持完整显示）

// 1. 裁掉透明边缘
// 2. 等比放大，使内容填满画布但不裁剪
// 3. 用透明背景填充到 1024×1024
const trimmed = await sharp(srcPath).trim({ threshold: 0 }).toFormat('png').toBuffer({ resolveWithObject: true });
const { width: tw, height: th } = trimmed.info;

const scaledWidth = Math.round(tw * SCALE);
const scaledHeight = Math.round(th * SCALE);

await sharp(trimmed.data)
  .resize(scaledWidth, scaledHeight, { fit: 'inside' })
  .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toFile(outPng);

console.log(`Wrote ${SIZE}x${SIZE} PNG (scaled ${SCALE}x) -> ${outPng}`);
