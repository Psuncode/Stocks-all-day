export type DemoUser = {
  name: string;
  email: string;
  role: "Trader" | "Analyst" | "PM" | "Admin";
  focus: "Momentum" | "Breakouts" | "Mean Reversion";
  lastLogin: string;
};

const STORAGE_KEY = "swingtrader.demo.user";

export function getDemoUser(): DemoUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DemoUser;
  } catch {
    return null;
  }
}

export function setDemoUser(user: DemoUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearDemoUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
