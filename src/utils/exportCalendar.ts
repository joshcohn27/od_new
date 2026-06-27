import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { AssignedNight, ScheduleConfig } from '../types';
import { DOW_LABELS, MONTH_NAMES, parseISODate, toISODate } from './dates';

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay());
}

/** Day number, unless it is the 1st of a new month ("July 1"). */
function dayCellLabel(d: Date): string {
  return d.getDate() === 1 ? `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}` : `${d.getDate()}`;
}

export function exportToCalendar(nights: AssignedNight[], config: ScheduleConfig): void {
  const dated = nights
    .map((n) => ({ assignment: n, date: parseISODate(n.night.date) }))
    .filter((n): n is { assignment: AssignedNight; date: Date } => n.date !== null);

  if (dated.length === 0) {
    throw new Error('No nights have a date assigned. Set a Session Start Date before exporting.');
  }

  const byDate = new Map<string, AssignedNight>();
  for (const { assignment, date } of dated) {
    byDate.set(toISODate(date), assignment);
  }

  const minTime = Math.min(...dated.map((d) => d.date.getTime()));
  const maxTime = Math.max(...dated.map((d) => d.date.getTime()));

  const gridStart = startOfWeek(new Date(minTime));
  const gridEnd = startOfWeek(new Date(maxTime));

  const weeks: Date[][] = [];
  for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
  }

  const allStaffNames = config.staff.map((s) => s.name);

  const headerRow = new TableRow({
    children: DOW_LABELS.map(
      (label) =>
        new TableCell({
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
        })
    ),
  });

  const weekRows = weeks.map(
    (week) =>
      new TableRow({
        children: week.map((d) => {
          const assignment = byDate.get(toISODate(d));

          if (!assignment) {
            return new TableCell({
              verticalAlign: VerticalAlign.TOP,
              children: [new Paragraph('')],
            });
          }

          const names = assignment.night.allStaffOnDuty
            ? allStaffNames
            : assignment.assigned.map((s) => s.name);

          return new TableCell({
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({ children: [new TextRun({ text: dayCellLabel(d), bold: true })] }),
              new Paragraph(''),
              new Paragraph('DO:'),
              new Paragraph(''),
              new Paragraph(`OD: ${names.join(', ')}`),
            ],
          });
        }),
      })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...weekRows],
  });

  const doc = new Document({
    sections: [{ children: [table] }],
  });

  Packer.toBlob(doc).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DOOD_Schedule.docx';
    a.click();
    URL.revokeObjectURL(url);
  });
}
