import type { ReactNode } from "react";

import { AreaMessages } from "../../../components/i18n/area-messages";

/* Scopes the translation payload to this area's namespaces — see
 * components/i18n/area-messages.tsx. Generated structure; the area name must
 * match this directory. */
export default function AreaLayout({ children }: { children: ReactNode }) {
  return <AreaMessages area="learning">{children}</AreaMessages>;
}
