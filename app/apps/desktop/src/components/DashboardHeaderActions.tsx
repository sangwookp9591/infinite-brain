// SPDX-License-Identifier: Apache-2.0
import { createContext } from "react";
import "../styles/dashboard.css";

/** React-owned portal destination: updates when the shell mounts or replaces it. */
export const DashboardHeaderActionsContext = createContext<HTMLDivElement | null>(null);
