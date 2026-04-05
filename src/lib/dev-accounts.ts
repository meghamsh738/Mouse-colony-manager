import { demoColonyData } from "@/data/demo-colony";

export function getSeededDevAccounts() {
  return demoColonyData.users.map((user) => ({
    email: user.email,
    password: user.password,
    role: user.role,
    name: user.name,
  }));
}
