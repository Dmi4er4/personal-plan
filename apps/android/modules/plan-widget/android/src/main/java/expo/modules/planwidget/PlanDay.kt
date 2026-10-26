package expo.modules.planwidget

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

internal fun planDate(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): LocalDate {
  val local = now.atZone(zone)
  return if (local.hour < 4) local.toLocalDate().minusDays(1) else local.toLocalDate()
}
