"use client";

import { useTransition } from "react";
import { BookPlus } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { useToast } from "@/components/admin/Toast";
import { loadStarterArticlesAction } from "./actions";

/** Inserts the starter articles whose slugs don't exist yet — never overwrites an edit. */
export function LoadStarterButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      icon={<BookPlus size={15} aria-hidden />}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await loadStarterArticlesAction();
          if (!r.ok) toast({ title: "Couldn't load starter articles", description: r.error, tone: "error" });
          else if (r.count === 0) toast({ title: "Starter articles already loaded", description: "Nothing new to add — existing articles were left as they are.", tone: "info" });
          else toast({ title: `${r.count} starter article${r.count === 1 ? "" : "s"} added`, description: "They're published with “being verified” shown until you confirm each one.", tone: "success" });
        })
      }
    >
      Load starter articles
    </Button>
  );
}
