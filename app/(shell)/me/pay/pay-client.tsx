"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageTabs, type PageTab } from "../../../../components/shared/page-tabs";
import { PageHeader } from "../../../../components/shared/page-header";
import type { UserRole } from "../../../../lib/navigation";
import { MeCompensationClient } from "../compensation/me-compensation-client";
import { MePaymentDetailsClient } from "../payment-details/payment-details-client";
import { MePayslipsClient } from "../payslips/payslips-client";

type PayClientProps = {
  requestedTab: string;
  userRoles: UserRole[];
};

function resolveInitialTab(requestedTab: string, tabs: PageTab[]): string {
  const validTabs = new Set(tabs.map((tab) => tab.key));

  if (validTabs.has(requestedTab)) {
    return requestedTab;
  }

  return "payslips";
}

export function PayClient({ requestedTab, userRoles }: PayClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs = useMemo<PageTab[]>(
    () => [
      {
        key: "payslips",
        label: "Payslips"
      },
      {
        key: "payment-details",
        label: "Payment Details"
      },
      {
        key: "compensation",
        label: "Compensation"
      }
    ],
    []
  );

  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(requestedTab, tabs));

  useEffect(() => {
    setActiveTab(resolveInitialTab(requestedTab, tabs));
  }, [requestedTab, tabs]);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (tabKey === "payslips") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tabKey);
    }

    const queryString = nextParams.toString();

    router.replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname, {
      scroll: false
    });
  };

  return (
    <>
      <PageHeader
        title="Pay"
        description="Pay statements, payout setup, and compensation in one view."
      />

      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userRoles={userRoles}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={activeTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {activeTab === "payslips" ? <MePayslipsClient embedded /> : null}
          {activeTab === "payment-details" ? <MePaymentDetailsClient embedded /> : null}
          {activeTab === "compensation" ? <MeCompensationClient embedded /> : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
