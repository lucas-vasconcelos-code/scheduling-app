import { API } from "./api";
export async function login() {
  window.location.assign(API + "/auth/google");
}
