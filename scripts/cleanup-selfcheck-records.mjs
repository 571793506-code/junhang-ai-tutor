import { prisma } from "@junhang/db";

const prefix = process.argv[2] || "自检";

const [broadcasts, dictations, readings, assignments] = await Promise.all([
  prisma.taskBroadcast.deleteMany({ where: { title: { startsWith: prefix } } }),
  prisma.dictationTask.deleteMany({ where: { title: { startsWith: prefix } } }),
  prisma.readingTask.deleteMany({ where: { title: { startsWith: prefix } } }),
  prisma.assignment.deleteMany({ where: { title: { startsWith: prefix } } })
]);

console.log(JSON.stringify({
  ok: true,
  prefix,
  deleted: {
    broadcasts: broadcasts.count,
    dictations: dictations.count,
    readings: readings.count,
    assignments: assignments.count
  }
}, null, 2));

await prisma.$disconnect();
