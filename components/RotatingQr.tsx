"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { QR_ROTATE_SECONDS } from "@/lib/config";

export function RotatingQr({ src, alt }: { src: string; alt: string }) {
  const [version, setVersion] = useState(() => Math.floor(Date.now() / (QR_ROTATE_SECONDS * 1000)));

  useEffect(() => {
    const interval = window.setInterval(
      () => setVersion(Math.floor(Date.now() / (QR_ROTATE_SECONDS * 1000))),
      QR_ROTATE_SECONDS * 1000,
    );
    return () => window.clearInterval(interval);
  }, []);

  return (
    <Image
      src={`${src}&v=${version}`}
      alt={alt}
      width={280}
      height={280}
      unoptimized
      className="h-56 w-56 sm:h-64 sm:w-64"
    />
  );
}
