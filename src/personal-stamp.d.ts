export const PERSONAL_STAMP_DEFAULTS: Readonly<{
  suffix: string; fontIdx: number; shape: string; style: string; layout: string;
  trad: boolean; stretch: boolean; glyphFill: number; spacing: number; doubleBorder: boolean;
  color: string; border: number; pad: number; rot: number;
  ink: number; grain: number; rough: number; seed: number;
}>;
/** 고를 수 있는 글씨체 — 0번이 기본(연성). */
export const STAMP_FONTS: ReadonlyArray<{ fam: string; w: number; label: string }>;
export function loadStampFont(name: string, fontIdx?: number): Promise<void>;
export type PersonalStampOverrides = Partial<{
  fontIdx: number; ink: number; grain: number; rough: number; seed: number; border: number; pad: number; rot: number;
}>;
export function drawPersonalStamp(
  canvas: HTMLCanvasElement,
  name: string,
  suffix?: string,
  style?: 'yang' | 'eum',
  overrides?: PersonalStampOverrides,
): void;
