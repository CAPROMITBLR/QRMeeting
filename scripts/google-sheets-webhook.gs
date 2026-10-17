/**
 * Optional receiver for MeetingQR's "Sync to Google Sheets" action.
 *
 * Setup:
 * 1. Create a Google Sheet with a tab named "Attendance".
 * 2. Open Extensions -> Apps Script and paste this file.
 * 3. Deploy as a Web app, execute as you, with access restricted as appropriate.
 * 4. Set GOOGLE_SHEETS_WEBHOOK_URL on the Next.js server to the deployment URL.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    if (body.action !== "syncAttendance" || !body.meeting || !Array.isArray(body.attendees)) {
      return output({ ok: false, error: "Invalid sync payload" }, 400);
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Attendance");
    if (!sheet) return output({ ok: false, error: "Attendance sheet not found" }, 500);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Meeting ID", "Meeting title", "Meeting start", "Name", "College ID", "Marked at", "Distance (m)"]);
    }

    var values = body.attendees.map(function (attendee) {
      return [
        String(body.meeting.id || ""),
        String(body.meeting.title || ""),
        String(body.meeting.startsAt || ""),
        String(attendee.name || ""),
        String(attendee.collegeId || ""),
        String(attendee.markedAt || ""),
        attendee.distanceM == null ? "" : Number(attendee.distanceM)
      ];
    });

    if (values.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
    }
    return output({ ok: true, count: values.length }, 200);
  } catch (error) {
    return output({ ok: false, error: String(error) }, 500);
  }
}

function output(value, status) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
