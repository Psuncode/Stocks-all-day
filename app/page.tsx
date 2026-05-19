import { redirect } from "next/navigation";

// GSD review L8: server can't read localStorage so login-gating at the
// root just adds an extra redirect. Scanner is the actual home now;
// /login remains opt-in.
export default function Home() {
  redirect("/scanner");
}
