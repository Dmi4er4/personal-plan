package expo.modules.planwidget

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class PlanDayTest {
  @Test fun dayChangesAtFourInLocalTime() {
    val zone = ZoneId.of("Europe/Minsk")
    assertEquals(LocalDate.parse("2026-10-24"), planDate(Instant.parse("2026-10-24T21:00:00Z"), zone))
    assertEquals(LocalDate.parse("2026-10-24"), planDate(Instant.parse("2026-10-25T00:59:59.999Z"), zone))
    assertEquals(LocalDate.parse("2026-10-25"), planDate(Instant.parse("2026-10-25T01:00:00Z"), zone))
    assertEquals(LocalDate.parse("2026-12-31"), planDate(Instant.parse("2026-12-31T23:00:00Z"), zone))
    assertEquals(LocalDate.parse("2028-02-29"), planDate(Instant.parse("2028-03-01T00:00:00Z"), zone))
  }

  @Test fun daylightSavingUsesWallTimeRatherThanFourElapsedHours() {
    val zone = ZoneId.of("Europe/Berlin")
    assertEquals(LocalDate.parse("2026-03-28"), planDate(Instant.parse("2026-03-29T01:59:59Z"), zone))
    assertEquals(LocalDate.parse("2026-03-29"), planDate(Instant.parse("2026-03-29T02:00:00Z"), zone))
    assertEquals(LocalDate.parse("2026-10-24"), planDate(Instant.parse("2026-10-25T02:59:59Z"), zone))
    assertEquals(LocalDate.parse("2026-10-25"), planDate(Instant.parse("2026-10-25T03:00:00Z"), zone))
  }
}
