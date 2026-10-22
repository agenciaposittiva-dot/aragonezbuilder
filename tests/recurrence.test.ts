import { describe, expect, it } from "vitest";
import { describeRule, firstOccurrence, nextAfter, nextAfterToday, upcoming } from "@/lib/recurrence";

describe("datas de rotina", () => {
  it("diária, a cada N dias", () => {
    expect(firstOccurrence({ frequency: "daily", interval: 1 }, "2026-10-22")).toBe("2026-10-22");
    expect(nextAfter({ frequency: "daily", interval: 2 }, "2026-10-30")).toBe("2026-11-01");
  });

  it("semanal no dia da semana escolhido", () => {
    // 22/10/2026 é quinta (4). Segunda (1) seguinte = 26/10.
    expect(firstOccurrence({ frequency: "weekly", interval: 1, weekday: 1 }, "2026-10-22")).toBe("2026-10-26");
    expect(firstOccurrence({ frequency: "weekly", interval: 1, weekday: 4 }, "2026-10-22")).toBe("2026-10-22");
    expect(nextAfter({ frequency: "weekly", interval: 2, weekday: 1 }, "2026-10-26")).toBe("2026-11-09");
  });

  it("mensal no dia do mês, atravessando o ano", () => {
    expect(firstOccurrence({ frequency: "monthly", interval: 1, monthday: 5 }, "2026-10-22")).toBe("2026-11-05");
    expect(firstOccurrence({ frequency: "monthly", interval: 1, monthday: 25 }, "2026-10-22")).toBe("2026-10-25");
    expect(nextAfter({ frequency: "monthly", interval: 3, monthday: 28 }, "2026-11-28")).toBe("2027-02-28");
  });

  it("pula datas que já passaram (worker parado alguns dias) sem gerar atrasadas em série", () => {
    expect(nextAfterToday({ frequency: "daily", interval: 1 }, "2026-10-10", "2026-10-22")).toBe("2026-10-23");
    expect(nextAfterToday({ frequency: "weekly", interval: 1, weekday: 1 }, "2026-10-05", "2026-10-22")).toBe(
      "2026-10-26",
    );
  });

  it("prévia e descrição em português", () => {
    expect(upcoming({ frequency: "weekly", interval: 1, weekday: 5 }, "2026-10-22")).toEqual([
      "2026-10-23",
      "2026-10-30",
      "2026-11-06",
    ]);
    expect(describeRule({ frequency: "weekly", interval: 1, weekday: 1 })).toBe("Toda segunda-feira");
    expect(describeRule({ frequency: "weekly", interval: 2, weekday: 0 })).toBe("A cada 2 semanas, no domingo");
    expect(describeRule({ frequency: "monthly", interval: 1, monthday: 5 })).toBe("Todo dia 5 do mês");
    expect(describeRule({ frequency: "daily", interval: 1 })).toBe("Todos os dias");
  });
});
