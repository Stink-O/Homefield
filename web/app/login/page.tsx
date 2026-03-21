import { LoginForm } from "./LoginForm";
import Image from "next/image";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm px-6">
        <div className="flex justify-center mb-8">
          <Image src="/logo-header.png" alt="HomeField" width={120} height={40} />
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
