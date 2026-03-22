import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/rides',
})
export class RidesGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private driverSockets = new Map<string, string>();
  private ownerSockets = new Map<string, string>(); // ← new

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    for (const [driverId, socketId] of this.driverSockets.entries()) {
      if (socketId === client.id) {
        this.driverSockets.delete(driverId);
        break;
      }
    }
    // Clean up owner sockets too
    for (const [ownerId, socketId] of this.ownerSockets.entries()) {
      if (socketId === client.id) {
        this.ownerSockets.delete(ownerId);
        break;
      }
    }
  }

  @SubscribeMessage('driver:register')
  handleDriverRegister(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.driverSockets.set(data.driverId, client.id);
    console.log(`Driver ${data.driverId} registered socket ${client.id}`);
  }

  // Owner registers their socket
  @SubscribeMessage('owner:register')
  handleOwnerRegister(
    @MessageBody() data: { ownerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.ownerSockets.set(data.ownerId, client.id);
    console.log(`Owner ${data.ownerId} registered socket ${client.id}`);
  }

  @SubscribeMessage('driver:location')
  handleLocationUpdate(
    @MessageBody() data: { driverId: string; lat: number; lng: number },
  ) {
    this.server.to(`driver:${data.driverId}`).emit('location:updated', {
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('track:driver')
  handleTrackDriver(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`driver:${data.driverId}`);
  }

  // Notify driver of new ride request
  notifyDriverNewRide(driverId: string, trip: any) {
    const socketId = this.driverSockets.get(driverId);
    if (socketId) {
      this.server.to(socketId).emit('ride:assigned', trip);
    }
  }

  // Notify owner that driver accepted
  notifyOwnerDriverAccepted(ownerId: string, data: any) {
    const socketId = this.ownerSockets.get(ownerId);
    if (socketId) {
      this.server.to(socketId).emit('ride:accepted', data);
    }
  }

  // Notify owner that driver declined or timed out
  notifyOwnerDriverDeclined(ownerId: string, data: any) {
    const socketId = this.ownerSockets.get(ownerId);
    if (socketId) {
      this.server.to(socketId).emit('ride:declined', data);
    }
  }

  // Notify owner that trip is complete and payment is needed
  notifyOwnerTripCompleted(ownerId: string, data: any) {
    const socketId = this.ownerSockets.get(ownerId);
    if (socketId) {
      this.server.to(socketId).emit('trip:completed', data);
    }
  }
}