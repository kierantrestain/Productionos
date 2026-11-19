"use client";
import { Icon } from "./icons";
export function PrintButton() {
  return <button className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" /> Print / save PDF</button>;
}
