"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { rpc } from "@/lib/api-client";

export const OPEN_PIN_EVENT = "parapilot:open-pin";

/** Owners and managers set the PIN they type to approve a cashier's return (opened from the user menu). */
export function PinDialog() {
  const t = useTranslations("returns.pin");
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onOpen = () => {
      setPin("");
      setOpen(true);
    };
    window.addEventListener(OPEN_PIN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PIN_EVENT, onOpen);
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await rpc("returns.set_my_pin", { pin }, true);
      toast.success(t("saved"));
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <InputOTP maxLength={6} value={pin} onChange={setPin} autoFocus inputMode="numeric" pattern="^[0-9]*$" containerClassName="justify-center">
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, i) => (
                <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button type="submit" size="lg" disabled={busy || pin.length < 4}>
            {busy && <Loader2 className="animate-spin" />}
            {t("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
