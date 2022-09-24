import { RaceState, UserProvider } from "./RaceState";
import { HandicapChangeReason, JoulesUsedClass, User, UserInterface, UserTypeFlags } from "./User";
import { assert2 } from "./Utils";
import { RideMap, RideMapElevationOnly, RideMapPartial } from "./RideMap";
import { ServerGame } from "./ServerGame";
import { RideMapHandicap } from "./RideMapHandicap";

export enum PORTS {
  TOURJS_WEBSOCKET_PORT = 8080,
  GENERAL_HTTP_PORT = 8081,
}
export const SERVER_UPDATE_RATE_HZ = 8;


export enum BasicMessageType {
  ClientToServerUpdate,
  ClientConnectionRequest,
  ClientConnectionResponse,
  ServerError,
  S2CPositionUpdate,
  S2CNameUpdate,
  S2CFinishUpdate,
  S2CImageUpdate,
  S2CClientChat,
  ClientToServerChat,
}

export enum CurrentRaceState {
  PreRace,
  Racing,
  PostRace,
}

export interface ClientToServerChat {
  chat: string;
  gameId:string;
  userId:number;
}

export interface C2SBasicMessage {
  type:BasicMessageType;
  payload:any; // check type, then cast to the appropriate message
}


export interface S2CBasicMessage {
  timeStamp:number;
  type:BasicMessageType;
  raceState:S2CRaceStateUpdate;
  payload:any; // check type, then cast to the appropriate message
}

export interface ServerError {
  text:string;
  stack:string;
}

export interface S2CPositionUpdateUser {
  id:number;
  distance:number;
  speed:number;
  power:number;
  hrm:number;
}
export interface S2CPositionUpdate {
  clients: S2CPositionUpdateUser[];
}
export class S2CRaceStateUpdate {
  constructor(tmNow:number, serverGame:ServerGame) {
    let msUntil = -1;
    let tmNextState = -1;

    if(serverGame) {
      switch(serverGame.getLastRaceState()) {
        case CurrentRaceState.PreRace:
          tmNextState = serverGame.getRaceScheduledStartTime();
          msUntil = Math.max(0, tmNextState - tmNow);
          break;
      }
      this.state = serverGame.getLastRaceState();
      this.msUntilNextState = msUntil;
      this.tmOfNextState = tmNextState;
    } else {
      this.state = CurrentRaceState.PreRace;
      this.msUntilNextState = 0;
      this.tmOfNextState = 0x7fffffff;
    }

  }
  state:CurrentRaceState;
  msUntilNextState:number;
  tmOfNextState:number;
}


export class S2CFinishUpdate {
  constructor(provider:UserProvider, tmRaceStart:number) {
    const tmNow = new Date().getTime();

    const users = provider.getUsers(tmNow);
    users.sort((u1, u2) => {
      if(!u1.isFinished()) {
        return 1;
      } else {
        if(!u2.isFinished()) {
          return 1;
        }

        return u1.getRaceTimeSeconds(tmRaceStart) < u2.getRaceTimeSeconds(tmRaceStart) ? -1 : 1;
      }
    })

    const raceLengthKm = Math.max(...users.map((u) => u.getDistance())) / 1000;
    this.raceLengthKm = raceLengthKm;
    this.tmRaceStart = tmRaceStart;
    this.names = [];
    this.rankings = [];
    this.times = [];
    this.hsSaved = [];
    this.efficiency = [];
    this.userSpending = [];
    this.types = [];
    this.handicaps = [];
    this.key = S2CFinishUpdate.getPermanentKey(this);
    users.forEach((user, index) => {
      this.names.push(user.getName());
      this.rankings.push(user.getId());
      this.times.push(user.getRaceTimeSeconds(tmRaceStart));
      this.hsSaved.push(user.getHandicapSecondsSaved());
      this.efficiency.push(user.getHandicapSecondsUsed()[JoulesUsedClass.WholeCourse] / raceLengthKm); // this is redundant, but around for backwards-compatibility
      this.userSpending.push(user.getHandicapSecondsUsed());
      this.types.push(user.getUserType());
      this.handicaps.push(user.getHandicap());
    })
  }
  static getPermanentKey(s2c:S2CFinishUpdate):string {
    if(s2c.key) {
      return s2c.key;
    }
    const dt = new Date(s2c.tmRaceStart);
    const lengthM = s2c.raceLengthKm*1000;
    return `${lengthM.toFixed(0)}m-${dt.getUTCFullYear()}-${dt.getUTCMonth()+1}-${dt.getUTCDate()}-${dt.getUTCHours()}-${dt.getUTCMinutes()}`;
  }
  key:string;
  raceLengthKm:number;
  tmRaceStart:number;
  names:string[];
  rankings: number[];
  times: number[];
  hsSaved: number[];
  efficiency: number[];
  userSpending: {[key:string]:number}[];
  types:number[];
  handicaps:number[];
}

export function apiGetInternal(apiRoot:string, endPoint:string, data?:any) {
  const slash = endPoint[0] === '/' || apiRoot[apiRoot.length - 1] === '/' ? '' : '/';

  let queries = '?';
  for(var key in data) {
    queries += key + '=' + encodeURIComponent(data[key]) + '&';
  }

  return fetch(apiRoot + slash + endPoint + queries, {
    method: 'GET',
  }).then((response) => {
    return response.json();
  })
}

export function apiPostInternal(apiRoot:string, endPoint:string, data?:any):Promise<any> {
  const slash = endPoint[0] === '/' || apiRoot[apiRoot.length - 1] === '/' ? '' : '/';
  const final = apiRoot + slash + endPoint;
  console.log("posting to ", final);
  return fetch(final, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data && JSON.stringify(data),
  }).then((response) => {
    return response.json();
  })
}

export class ServerMapDescription {
  constructor(map:RideMapElevationOnly) {
    const n = 2000;
    const endLength = map.getLength();

    this.distances = [];
    this.elevations = [];
    for(var x = 0;x < n; x++) {
      const sampleDistance = (x/n)*endLength;
      const elev = map.getElevationAtDistance(sampleDistance);
      if(isFinite(elev) && isFinite(sampleDistance)) {
        this.distances.push(sampleDistance);
        this.elevations.push(elev);
      } else {
        assert2(false, "Why are these elevations not finite?");
      }
    }
  }

  distances:number[];
  elevations:number[];
}

export interface ClientConnectionRequest {
  sub:string;
  riderName:string; // name of your rider.  So the "Jones Household" account might have riders "SarahJones" and "GeorgeJones"
  imageBase64:string|null; // image of your rider
  accountId:string;
  riderHandicap:number;
  gameId:string;
  bigImageMd5:string|null;
} 
export interface ClientConnectionResponse {
  yourAssignedId:number; // given your name/account combo, here's an id for your rider
  map:ServerMapDescription; // here's the map we're riding on.
}

export class S2CImageUpdate {

  constructor(user:UserInterface) {
    this.id = user.getId();

    const image = user.getImage();
    if(!image) {
      throw new Error("You're trying to send an image update for a user without an image?");
    }
    this.imageBase64 = image;
  }

  id:number;
  imageBase64:string;
}

export interface S2CChatUpdate {
  fromId: number;
  chat: string;
}
export class S2CNameUpdate {

  constructor(tmNow:number, provider:UserProvider) {
    const users = provider.getUsers(tmNow);

    this.names = [];
    this.ids = [];
    this.userTypes = [];
    this.userHandicaps = [];
    users.forEach((user) => {
      this.names.push(user.getName());
      this.ids.push(user.getId());
      this.userTypes.push(user.getUserType());
      this.userHandicaps.push(user.getHandicap());
    })
  }

  names: string[];
  ids: number[];
  userTypes: number[];
  userHandicaps: number[];
}

export interface PacingChallengeResultSubmission {
  mapName:string;
  pct:number;
  "name": string;
  "time": number;
  "hsLeft": number;
}

export class ClientToServerUpdate {
  constructor(raceState:RaceState) {
    const localGuy = raceState.getLocalUser();
    if(!localGuy) {
      throw new Error("Can't build a ClientToServerUpdate without a local player!");
    }
    this.gameId = raceState.getGameId();
    this.userId = localGuy.getId();
    assert2(this.userId >= 0, "We can't really tell the server about our user unless we know his id...");
    this.lastPower = localGuy.getLastPower();

    const hrm = localGuy.getLastHrm(new Date().getTime());
    
    if(hrm > 0) {
      this.lastHrm = hrm;
    }
  }
  gameId:string;
  userId:number;
  lastPower:number;
  lastHrm?:number;
}

export function getElevationFromEvenSpacedSamples(meters:number, lengthMeters:number, elevations:number[]) {
  const pctRaw = meters / lengthMeters;
  const n = elevations.length - 1;
  if(pctRaw < 0) {
    return elevations[0];
  } else if(pctRaw >= 1) {
    return elevations[n - 1];
  } else {
    const ixLeft = Math.floor(pctRaw * n);
    const ixRight = ixLeft + 1;
    assert2(ixLeft >= 0 && ixLeft <=  elevations.length - 2);
    assert2(ixRight >= 0 && ixRight <=  elevations.length - 1);

    const distLeft = (ixLeft / n)*lengthMeters;
    const distRight = (ixRight / n)*lengthMeters;
    const elevLeft = elevations[ixLeft];
    const elevRight = elevations[ixRight];

    const offset = meters - distLeft;
    const span = distRight - distLeft;
    const pct = offset / span;
    assert2(pct >= -0.001 && pct <= 1.001);
    assert2(offset >= -0.001);
    assert2(distRight > distLeft);
    return pct*elevRight + (1-pct)*elevLeft;
  }

}

// a wrapper class to start translating a ScheduleRacePostRequest into a map we can actually load and ride
export class SimpleElevationMap extends RideMapPartial {
  elevations:number[];
  lengthMeters:number;
  constructor(elevations:number[], lengthMeters:number) {
    super();
    this.elevations = elevations;
    this.lengthMeters = lengthMeters;

    elevations.forEach((elev) => {
      assert2(isFinite(elev));
    })
  }
  getElevationAtDistance(meters: number): number {
    const ret = getElevationFromEvenSpacedSamples(meters, this.lengthMeters, this.elevations);
    assert2(isFinite(ret));
    return ret;
  }
  getLength(): number {
    return this.lengthMeters;
  }
}

export class ServerHttpGameListElement {
  constructor(tmNow:number, game:ServerGame) {
    this.gameId = game.raceState.getGameId();
    this.displayName = game.getDisplayName();
    this.status = game.getLastRaceState();
    this.tmScheduledStart = game.getRaceScheduledStartTime();
    this.tmActualStart = game.getRaceStartTime();
    this.url = `/ride/${this.gameId}`;
    this.whoIn = game.userProvider.getUsers(tmNow).filter((user) => {
      return !(user.getUserType() & UserTypeFlags.Ai);
    }).map((user) => user.getName());
    this.whoInAi = game.userProvider.getUsers(tmNow).filter((user) => {
      return user.getUserType() & UserTypeFlags.Ai;
    }).map((user) => user.getName());

    const n = 100;
    const map = game.raceState.getMap();
    const mapLen = map.getLength();
    this.lengthMeters = mapLen;
    this.elevations = [];
    for(var x = 0;x < 100; x++) {
      const pct = x / n;
      
      const elev = map.getElevationAtDistance(pct*mapLen);
      this.elevations.push(elev);
    }
  }
  gameId: string;
  displayName: string;
  status: CurrentRaceState;
  tmScheduledStart: number;
  tmActualStart: number;
  whoIn: string[];
  whoInAi: string[];
  elevations: number[];
  lengthMeters: number;
  url:string;
}
export interface ServerHttpGameList {
  races: ServerHttpGameListElement[];
}

export interface IWorkoutSample {
  power:number;
  tm:number;
  distance:number;
  speedMetersPerSec:number;
  hrm:number;
}

export interface RaceResultSubmission {
  rideName: string; // "<rider name> 14990m on <date> and <mapname> doing <activity>"
  riderName: string; // your rider's name
  activityName: string;
  deviceName:string;
  tmStart: number;
  tmEnd: number;
  handicap: number; // your handicap when you rode
  samples: IWorkoutSample[];
  bigImageMd5: string;
}

export default class ConnectionManager {
  static _this:ConnectionManager = null;

  _timeout:any = 0;
  _ws:WebSocket|null = null;
  _raceState:RaceState|null = null;
  _gameId:string = '';
  _lastServerRaceState:S2CRaceStateUpdate|null = null;
  raceResults:S2CFinishUpdate|null = null;
  _lastTimeStamp = 0;
  _imageSources:Map<number,string> = new Map();
  _userProvider:UserProvider|null = null;
  _desiresDisconnect:boolean = false;

  _onLocalHandicapChange:(newHandicap:number)=>void;
  _onLastServerRaceStateChange:()=>void;
  _onNetworkUpdateComplete:(fromWho:ConnectionManager, count:number)=>void;
  _networkUpdates = 0;
  _notifyNewClient:(client:S2CPositionUpdateUser, image:string|null)=>void;
  _lastWebsocket = null;

  constructor(onLocalHandicapChange:(newHandicap:number)=>void,
              onLastServerRaceStateChange:()=>void,
              onNetworkUpdateComplete:(fromWho:ConnectionManager, count:number)=>void,
              notifyNewClient:(client:S2CPositionUpdateUser, image:string|null)=>void) {

    ConnectionManager._this = this; // always have the singleton as myself
    this._onLocalHandicapChange = onLocalHandicapChange;
    this._onLastServerRaceStateChange = onLastServerRaceStateChange;
    this._onNetworkUpdateComplete = onNetworkUpdateComplete;
    this._notifyNewClient = notifyNewClient
  }

  _performStartupNegotiate(sub:string, ws:WebSocket, user:UserInterface, accountId:string, gameId:string):Promise<ClientConnectionResponse> {
    const oldOnMessage = ws.onmessage;

    return new Promise((resolve, reject) => {
      ws.onmessage = (msg:MessageEvent) => {
        if(ws !== this._lastWebsocket) {
          // ignore messages from this websocket, since it is not the last one we negotiated
          console.log("we just got a message from ", ws, ", but it wasn't the same as this._lastWebsocket ", this._lastWebsocket);
          try {
            ws.close();
          } catch(e) {}
          return;
        }
        try {
          const basicMessage:S2CBasicMessage = JSON.parse(msg.data);
          this._lastServerRaceState = basicMessage.raceState;
          this._onLastServerRaceStateChange();

          const payload:ClientConnectionResponse = <ClientConnectionResponse>basicMessage.payload;
          resolve(payload);
        } catch(e) {
          debugger;
          reject(e);
        }
      };

      

      // ok, we've got our listener set up
      const connect:ClientConnectionRequest = {
        sub,
        riderName: user.getName(),
        imageBase64: user.getImage(),
        bigImageMd5: user.getBigImageMd5(),
        accountId: accountId,
        riderHandicap: user.getHandicap(),
        gameId: gameId,
      }
      const bm:C2SBasicMessage = {
        payload: connect,
        type: BasicMessageType.ClientConnectionRequest,
      }
      ws.send(JSON.stringify(bm));
    }).then((ccr:ClientConnectionResponse) => {
      ws.onmessage = oldOnMessage;
      return ccr;
    })
  }

  connect(sub:string, wsUrl:string, userProvider:UserProvider, gameId:string, accountId:string, user:UserInterface, fnOnNewRaceState:(raceState:RaceState)=>void):Promise<RaceState> {
    this._desiresDisconnect = false;
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        console.log("websocket opened!");
        resolve(ws);
      }
      ws.onerror = (err) => {
        console.log("websocket error, shutting down");
        reject(err);
        ws.close();
        debugger;
      }


      let reconnectTimeout:any = null;
      ws.onclose = () => {
        console.log("websocket closed");

        const tryConnectAgain = () => {
          if(this._desiresDisconnect) {
            return;
          }
          console.log("attempting reconnect to ", gameId);
          this.connect(sub, wsUrl, userProvider, gameId, accountId, user, fnOnNewRaceState).then((newRaceState) => {
            // woohoo, we reconnected!
            fnOnNewRaceState(newRaceState);
          }, (failure) => {
            console.log("failed in attempted reconnect ", failure);
            // oh well, I guess we will try again.
            if(window.location.pathname === `/ride/${gameId}`) {
              clearTimeout(reconnectTimeout);
              reconnectTimeout = setTimeout(tryConnectAgain, 1000);
            }
          });
        }

        if(this._desiresDisconnect) {

        } else {
          reconnectTimeout = setTimeout(tryConnectAgain, 1000);
        }
      }
    }).then((ws:WebSocket) => {
      if(!user) {
        throw new Error("You don't have a user, how do you expect to connect?");
      }
      this._lastWebsocket = ws;
      return this._performStartupNegotiate(sub, ws, user, accountId, gameId).then((ccr:ClientConnectionResponse) => {
        user.setId(ccr.yourAssignedId);

        this._userProvider = userProvider;
        const map = new RideMapHandicap(ccr.map);
        const raceState = new RaceState(map, userProvider, gameId);
        this._raceState = raceState;
        this._ws = ws;
        this._gameId = gameId;
        ws.onmessage = (event:MessageEvent) => this._onMsgReceived(ws, event);
        return this._raceState;
      })
    }).then((raceState:RaceState) => {
      this.scheduleNetworkTick();
      return raceState;
    })
    
  }

  _onMsgReceived(fromWs:WebSocket, event:MessageEvent) {
    if(fromWs !== this._lastWebsocket) {
      console.log("we got a big message ", fromWs, " but it wasn't the same as ", this._lastWebsocket);
      fromWs.close();
      return;
    }
    if(this !== ConnectionManager._this) {
      // we're not the latest/greatest connection manage, so exit
      return;
    }
    const tmNow = new Date().getTime();

    let bm:S2CBasicMessage;
    try {
      bm = JSON.parse(event.data);
    } catch(e) {
      throw new Error("Invalid message received: " + event.data);
    }
    if(bm.timeStamp <= this._lastTimeStamp) {
      console.log("bouncing a message because it's earlier or same-time as the last one we got");
      return;
    } else if(!isFinite(bm.timeStamp)) {
      return;
    }
    this._lastTimeStamp = bm.timeStamp;

    this._lastServerRaceState = bm.raceState;
    this._onLastServerRaceStateChange();
    if(this._raceState && this._userProvider) {
      switch(bm.type) {
        case BasicMessageType.S2CClientChat:
        {
          const update:S2CChatUpdate = <S2CChatUpdate>bm.payload;
          console.log("chat: ", update);
          const fromUser = this._userProvider.getUser(update.fromId);
          if(fromUser) {
            console.log(fromUser.getName() + " said " + update.chat);
            fromUser.setChat(tmNow, update.chat);
          }
          break;
        }
        case BasicMessageType.S2CNameUpdate:

          const update:S2CNameUpdate = <S2CNameUpdate>bm.payload;
          const localUser = this._userProvider.getLocalUser();
          if(localUser) {
            update.ids.forEach((id, index) => {
              const newHandicap = update.userHandicaps[index];
              if(id === localUser.getId() && 
                 isFinite(newHandicap) && 
                 newHandicap > localUser.getHandicap()) {
                // they've updated our user's handicap!  good for them for getting a PB!
                // let's store their new handicap so they don't have to remember to update it...
                console.log("the server has updated our user's handicap to ", newHandicap.toFixed(1));

                localUser.setHandicap(newHandicap, HandicapChangeReason.ServerRehandicap);
                this._onLocalHandicapChange(newHandicap);
              }
            })

          }

          this._raceState.absorbNameUpdate(tmNow, bm.payload);
          break;
        case BasicMessageType.S2CPositionUpdate:
        {
          // let's make sure that the user provider knows about all these users
          const posUpdate:S2CPositionUpdate = bm.payload;
          posUpdate.clients.forEach((client) => {
            if(this._userProvider) {
              const hasIt = this._userProvider.getUser(client.id);
              if(!hasIt) {
  
                const image = this._imageSources.get(client.id) || null;
  
                this._notifyNewClient(client, image);
              }
            }
          })
          

          this._raceState.absorbPositionUpdate(tmNow, bm.timeStamp, bm.payload);
          break;
        }
        case BasicMessageType.S2CImageUpdate:
        {
          const imageUpdate:S2CImageUpdate = bm.payload;
          const user = this._raceState.getUserProvider().getUser(imageUpdate.id);
          this._imageSources.set(imageUpdate.id, imageUpdate.imageBase64);
          if(user) {
            console.log("received an image for ", user.getName());
            user.setImage(imageUpdate.imageBase64, null);
          }

          break;
        }
        case BasicMessageType.ServerError:
          assert2(false);
          break;
        case BasicMessageType.ClientConnectionResponse:
          assert2(false);
          break;
        case BasicMessageType.S2CFinishUpdate:
          this.raceResults = bm.payload;
          break;
      }
      this._onNetworkUpdateComplete(this, this._networkUpdates++);
    } else {
      debugger;
      this._ws?.close();
      clearTimeout(this._timeout);
      this._timeout = null;
      this._raceState = null;
    }
    
  }

  get preRace():boolean {
    return (this._lastServerRaceState && this._lastServerRaceState.state === CurrentRaceState.PreRace) || false;
  }
  get racing():boolean {
    return (this._lastServerRaceState && this._lastServerRaceState.state === CurrentRaceState.Racing) || false;
  }
  get postRace():boolean {
    return (this._lastServerRaceState && this._lastServerRaceState.state === CurrentRaceState.PostRace) || false;
  }
  get msOfStart():number {
    return (this._lastServerRaceState && this._lastServerRaceState.tmOfNextState) || 0;
  }

  disconnect() {
    this._timeout = null;
    clearTimeout(this._timeout);
    this._desiresDisconnect = true;

    if(this._ws) {
      this._ws.onmessage = () => {};
      this._ws.close();
    }
    this._raceState = null;
  }

  getUserName(userId:number):string {
    if(this._userProvider) {
      const user = this._userProvider.getUser(userId);
      return user && user.getName() || "Unknown";
    } else {
      return "Unknown";
    }
  }

  chat(chat:string) {

    if(this._ws && this._userProvider) {
      const localUser = this._userProvider.getLocalUser();
      if(localUser) {
        if(this._gameId) {
          const msgChat:ClientToServerChat = {
            chat,
            gameId:this._gameId,
            userId:localUser.getId(),
          }
          const wrapper:C2SBasicMessage = {
            type: BasicMessageType.ClientToServerChat,
            payload: msgChat,
          };
          console.log("sending chat from user ", localUser.getId());
          this._ws.send(JSON.stringify(wrapper));
        }
      }
    }
  }

  tick() {
    if(this._ws && this._raceState) {
      // ok, we gotta send our game state back to the main server
      
      const update = new ClientToServerUpdate(this._raceState);
      const wrapper:C2SBasicMessage = {
        type: BasicMessageType.ClientToServerUpdate,
        payload: update,
      };
      this._ws.send(JSON.stringify(wrapper));
      this.scheduleNetworkTick();
    }
  }

  getRaceState():RaceState {
    if(this._raceState) {
      return this._raceState;
    } else {
      throw new Error("We don't have a game state!");
    }
  }

  scheduleNetworkTick() {
    this._timeout = setTimeout(() => {
      this.tick();
    }, 250);
  }
}