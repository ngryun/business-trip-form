export const PERSONAL_STAMP_DEFAULTS: Readonly<{
  suffix: string; fontIdx: number; shape: string; style: string; layout: string;
  trad: boolean; stretch: boolean; glyphFill: number; spacing: number; doubleBorder: boolean;
  color: string; border: number; pad: number; rot: number;
  ink: number; grain: number; rough: number; seed: number;
}>;
export function loadStampFont(name: string): Promise<void>;
export function drawPersonalStamp(canvas: HTMLCanvasElement, name: string, suffix?: string, style?: 'yang' | 'eum'): void;
