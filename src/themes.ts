export interface Theme {
  id: string;
  label: string;
  dark: boolean;
}

export const THEMES: Theme[] = [
  { id: "dark", label: "Dark", dark: true },
  { id: "light", label: "Light", dark: false },
  { id: "solarized-dark", label: "Solarized Dark", dark: true },
  { id: "solarized-light", label: "Solarized Light", dark: false },
  { id: "nord", label: "Nord", dark: true },
  { id: "dracula", label: "Dracula", dark: true },
  { id: "gruvbox-dark", label: "Gruvbox Dark", dark: true },
  { id: "gruvbox-light", label: "Gruvbox Light", dark: false },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", dark: true },
  { id: "catppuccin-latte", label: "Catppuccin Latte", dark: false },
];

const KEY = "pkm-theme";

export function getStoredTheme(): string {
  const id = localStorage.getItem(KEY);
  return THEMES.some((t) => t.id === id) ? id! : "dark";
}

export function applyTheme(id: string): void {
  document.documentElement.setAttribute("data-theme", id);
  localStorage.setItem(KEY, id);
}

// Called once at startup (before React renders) so the page never flashes
// the default theme before switching to whatever was last chosen.
export function applyStoredTheme(): void {
  document.documentElement.setAttribute("data-theme", getStoredTheme());
}

export function isDarkTheme(id: string): boolean {
  return THEMES.find((t) => t.id === id)?.dark ?? true;
}
