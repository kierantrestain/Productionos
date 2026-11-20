"use client";
import { Dialog as AstryxDialog } from "@astryxdesign/core/Dialog";
import { X } from "lucide-react";

type Props = React.ComponentProps<typeof AstryxDialog>;

/** Astryx dialog with a consistent close button. Escape and the close button both dismiss it. */
export function Dialog(props: Props) {
  return (
    <AstryxDialog {...props}>
      <button type="button" className="ui-modal-x" aria-label="Close" onClick={() => props.onOpenChange(false)}><X size={18} /></button>
      {props.children}
    </AstryxDialog>
  );
}
