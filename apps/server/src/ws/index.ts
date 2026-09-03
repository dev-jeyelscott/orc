import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";

export async function registerWebSocket(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "connected" }));

    socket.on("message", (message: Buffer) => {
      socket.send(message.toString());
    });
  });
}
