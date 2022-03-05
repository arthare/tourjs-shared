import auth0, { Auth0Client, User as Auth0User } from '@auth0/auth0-spa-js';
import { apiGet } from 'bt-web2/set-up-ride/route';

export interface TourJsAlias {
  name:string;
  handicap:string;
  imageBase64:string;
}

export interface TourJsAccount {
  username?:string;
  aliases: TourJsAlias[];
}


export interface SignInResult {
  signedIn:boolean;
  account?:TourJsAccount;
  auth0?:Auth0User;
}


export class TourJsSignin {
  auth0: Auth0Client;
  constructor() {
    // <Auth0Provider domain="dev-enlwsasz.us.auth0.com" clientId="sVfg9SlUyknsFxwh74CDlseT0aL7iWS8" redirectUri={window.location.origin}>
    this.auth0 = new Auth0Client({
      domain: "dev-enlwsasz.us.auth0.com",
      client_id: "sVfg9SlUyknsFxwh74CDlseT0aL7iWS8",
      redirect_uri: window.location.origin,
    })
  }

  async isSignedIn():Promise<SignInResult> {
    const signedIn = await this.auth0.isAuthenticated();
    if(signedIn) {
      // let's get client details
      const deets = await this.auth0.getUser();
      if(deets?.sub) {
        const account = await this._getAccount(deets.sub);
        return {
          signedIn,
          account,
          auth0: deets,
        }
      } else {
        throw new Error(`No sub found for your auth0 user`);
      }

    } else {
      return {
        signedIn,
      }
    }
  }



  //////////////////////////////////
  // private stuff
  //////////////////////////////////
  private async _getAccount(sub:string):Promise<TourJsAccount> {
    return apiGet('user-account', {sub}) as Promise<TourJsAccount>;
  }
}