// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

/** One component demo on the lab page. */
export interface Demo {
  id: string;
  title: string;
  /** Where it lands in the app (spec §6.4). */
  usage: string;
  wide?: boolean;
  render: () => ReactNode;
}
