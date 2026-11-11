// Connection check for MONGODB_URI: ping, then write, read and delete one test document.
// Usage: npm run db:check   (reads .env.local; never prints the connection string)
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB?.trim() || "comparethink";
if (!uri) {
  console.error("MONGODB_URI is not set in .env.local");
  process.exit(1);
}
const host = (() => {
  try {
    return new URL(uri).host;
  } catch {
    return "(unparseable URI)";
  }
})();
console.log(`Connecting to ${host}, database "${dbName}" ...`);
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  console.log("✓ ping");
  const checks = db.collection("_connection_check");
  const { insertedId } = await checks.insertOne({
    checked_at: new Date(),
    from: process.env.HOSTNAME || "unknown-host",
  });
  const found = await checks.findOne({ _id: insertedId });
  if (!found) throw new Error("Inserted document could not be read back");
  console.log("✓ write and read");
  await checks.deleteOne({ _id: insertedId });
  console.log("✓ delete");
  console.log("Database connection OK.");
} catch (error) {
  const message = String(error?.message ?? error);
  console.error(`✗ ${message}`);
  if (/bad auth|authentication failed/i.test(message))
    console.error(
      "→ Check the username and password in MONGODB_URI (Atlas: Database Access).",
    );
  else if (
    /Server selection timed out|ECONNREFUSED|ETIMEDOUT|tlsv1 alert internal error|SSL alert number 80/i.test(
      message,
    )
  )
    console.error(
      "→ This machine's IP is probably not allowed. Add it in Atlas: Network Access → IP Access List.",
    );
  else if (/querySrv|ENOTFOUND/i.test(message))
    console.error(
      "→ The cluster host name could not be resolved. Check the part after @ in MONGODB_URI.",
    );
  process.exitCode = 1;
} finally {
  await client.close();
}
