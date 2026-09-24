import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { showUpdatePaymentMethodFromMetadata } from "@/lib/update-payment-method-visibility";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("update payment method account wiring", () => {
  const client = read("src/app/user/[[...user]]/user-account-client.tsx");
  const page = read("src/app/user/[[...user]]/page.tsx");
  const route = read("src/app/api/stripe/customer-portal/route.ts");
  const cancel = read("src/app/cancel/page.tsx");
  const cancelClient = read("src/app/cancel/cancel-flow-client.tsx");
  const manage = read("src/components/manage-membership-button.tsx");

  it("shows Update payment method from a server flag, not a client Stripe id", () => {
    expect(client).toContain("Update payment method");
    expect(client).toContain('data-testid="update-payment-method"');
    expect(client).toContain('fetch("/api/stripe/customer-portal"');
    expect(client).toContain("showUpdatePaymentMethod ? <UpdatePaymentMethodButton />");
    expect(client).not.toContain("stripeCustomerId");
    expect(client).not.toContain("stripeSubscriptionId");
    expect(page).toContain("showUpdatePaymentMethodFromMetadata");
    expect(page).toContain("showUpdatePaymentMethod={showUpdatePaymentMethod}");
    expect(page).not.toContain("subscriptions.retrieve");
  });

  it("does not hide the control when membership is inactive", () => {
    expect(
      showUpdatePaymentMethodFromMetadata({
        stripeCustomerId: "cus_past_due",
        summittSubscribed: false,
        summittPlan: null,
      })
    ).toBe(true);
    expect(
      showUpdatePaymentMethodFromMetadata({
        summittSubscribed: false,
      })
    ).toBe(false);
    expect(showUpdatePaymentMethodFromMetadata({ stripeCustomerId: "  " })).toBe(
      false
    );
    const helper = read("src/lib/update-payment-method-visibility.ts");
    expect(helper).toContain("stripeCustomerId");
    expect(helper).not.toContain("summittSubscribed");
    expect(helper).not.toContain("subscriptions.retrieve");
  });

  it("posts to the portal route and does not send the member to /cancel", () => {
    const buttonStart = client.indexOf("function UpdatePaymentMethodButton");
    const buttonEnd = client.indexOf("function AccountTopCard");
    const button = client.slice(buttonStart, buttonEnd);
    expect(button).toContain('fetch("/api/stripe/customer-portal"');
    expect(button).not.toContain("/cancel");
    expect(button).not.toContain("href=");
    expect(manage).toContain('router.push("/cancel")');
    expect(cancel).toContain("CancelFlowClient");
    expect(cancelClient).toContain('fetch("/api/cancel-membership"');
  });

  it("does not introduce a full portal management link", () => {
    expect(client).not.toContain("Manage billing");
    expect(client).not.toContain("subscription_cancel");
    expect(client).not.toContain("subscription_update");
    expect(route).toContain('type: "payment_method_update"');
    expect(route).not.toContain("subscription_cancel");
    expect(route).not.toContain("subscription_update");
    expect(route).not.toContain("subscriptions.cancel");
    expect(page).not.toContain("billingPortal");
  });
});
