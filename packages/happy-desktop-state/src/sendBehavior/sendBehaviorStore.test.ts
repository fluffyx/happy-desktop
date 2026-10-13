import { expect, it, vi } from "vitest";
import {
    messageDeliveryOpposite,
    sendBehaviorStoreCreate,
    type SendBehaviorDocument,
} from "./sendBehaviorStore.js";

it("starts on steer, switches at once for every subscriber, and writes only the change", () => {
    const write = vi.fn<(document: SendBehaviorDocument) => void>();
    const store = sendBehaviorStoreCreate({ read: () => undefined, write });
    const listener = vi.fn();
    const other = vi.fn();
    store.subscribe(listener);
    const otherStop = store.subscribe(other);
    expect(store.get().followUp).toBe("steer");

    store.followUpUpdate("queue");
    expect(store.get().followUp).toBe("queue");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ followUp: "queue" });

    // Saying the same thing again changes nothing.
    store.followUpUpdate("queue");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);

    // An unsubscribed listener hears nothing more; the rest still do.
    otherStop();
    store.followUpUpdate("steer");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
});

it("reads the stored choice back, and treats a malformed or refused record as steer", () => {
    expect(
        sendBehaviorStoreCreate({
            read: () => ({ followUp: "queue" }),
            write: () => undefined,
        }).get().followUp,
    ).toBe("queue");
    expect(
        sendBehaviorStoreCreate({
            read: () => ({ followUp: "later" }) as unknown as SendBehaviorDocument,
            write: () => undefined,
        }).get().followUp,
    ).toBe("steer");
    expect(
        sendBehaviorStoreCreate({
            read: () => "queue" as unknown as SendBehaviorDocument,
            write: () => undefined,
        }).get().followUp,
    ).toBe("steer");
    const refused = sendBehaviorStoreCreate({
        read: () => {
            throw new Error("denied");
        },
        write: () => {
            throw new Error("denied");
        },
    });
    expect(refused.get().followUp).toBe("steer");
    refused.followUpUpdate("queue");
    expect(refused.get().followUp).toBe("queue");
});

it("names the opposite delivery", () => {
    expect(messageDeliveryOpposite("steer")).toBe("queue");
    expect(messageDeliveryOpposite("queue")).toBe("steer");
});
