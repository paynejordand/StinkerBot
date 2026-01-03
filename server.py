# generate the protobuf bindings by doing `protoc events.proto --python_out='.'`
# before running, do `python -m pip install asyncio websockets`

import asyncio
import websockets
import json
import difflib

class WSServer:
    def __init__(self, host='localhost', port=7777):
        self.host = host
        self.port = port
        self.server = None
        self.swap = True
        self.names = set()

    async def handle_message(self, message):
        incoming = json.loads(message)
        if "category" in incoming:
            await self.apex_message(incoming)
        else:
            await self.client_message(incoming)
    
    async def client_message(self, incoming):
        if "swapCam" in incoming:
            print(f"--- Swapping to next instance of player damage ---")
            self.swap = True
            return
        
        print(f"Broadcasting: {incoming}")
        if "changeCam" in incoming:
            if "name" in incoming.get("changeCam"):
                specName = incoming.get("changeCam").get("name")
                specName = difflib.get_close_matches(specName.lower(), self.names, 1, 0.4)
                if not specName:
                    return
                incoming.get("changeCam")["name"] = specName[0]
                print(specName)
        websockets.broadcast(self.server.connections, json.dumps(incoming))
    
    async def apex_message(self, incoming):
        if incoming.get("category") == "playerDamaged":
            if incoming.get("attacker").get("nucleusHash") == "":
                #print(incoming)
                return
            if self.swap:
                print(f"--- Player damaged event detected ---")
                self.swap = False
                attacker = incoming.get("attacker").get("name")
                cam_message = json.dumps({"changeCam": {"name": attacker}})
                print(f"--- Swapping camera to attacker: {attacker} ---")
                websockets.broadcast(self.server.connections, cam_message)
        elif incoming.get("category") == "playerConnected":
            self.names.add(incoming.get("player").get("name").lower())
        elif incoming.get("category") == "matchStateEnd":
            self.names.clear()

    async def main(self, websocket):
        print(f"Connecting to {websocket.remote_address[0]}!")
        print(self.server.connections)

        async for message in websocket:
            try:
                await self.handle_message(message)
            except Exception as e:
                print(e)
                continue
            
    async def start(self):
        async with websockets.serve(self.main, self.host, self.port, open_timeout=None, ping_timeout=None) as serv:
            self.server = serv
            print(f"Serving on port {self.port}...")
            await asyncio.Future()

if __name__ == "__main__":
    server = WSServer()
    asyncio.run(server.start())