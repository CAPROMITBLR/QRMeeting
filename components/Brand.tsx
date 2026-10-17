import Image from "next/image";
import Link from "next/link";

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex items-center gap-3">
      <Link href="/" className="flex items-center gap-3">
        <Image src="/logo.png" alt="MAHE" width={44} height={44} className="h-11 w-11 object-contain" />
        <span className="leading-tight">
          <span className="block font-serif text-lg font-bold text-navy">Meeting Attendance</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">
            {subtitle ?? "Manipal Academy of Higher Education"}
          </span>
        </span>
      </Link>
    </header>
  );
}
