# TODO

p0
- improve poker default screen: add riffle shuffle + bridge animation
- improve screens to understand what is going on in the game. e.g. add splash screens / or brif popups for who won, what hand they had, etc.
- improve overall UI with where to show the pot, the player actions, etc. see youtube videos of wsop or other live poker for inspiration
- add preset camera screens to easily jump between views without manual zoom / rotation / panning. these should be included: your hand, entire table, dealt cards (zoomed in birds eye view of the cards dealt. need to increase max zoom allowed a tiny bit). after the flop, turn, and river, should auto change camera to the dealt cards view for a moment before restoring the previous state (so user can see the cards dealt better)
- add chips 3d stuff. can be made by claude no 3d model import needed. just to represent who the chip leader is easier. when bets are made, move chips in front of the user, then add up chips in the middle of the pot. for better visuals. users do not phyisically drag their chips in, still use the tui to take game actions.
- for the chat panel. add a brief that represent the game state after new hands. e.g. who won, what hand they had, who lost, chip leader, etc. 
- restructure the bottom left button thing. it takes up too much space and looke a bit awqward. maybe add a toggle to show / hide the button panel? maybe this should just be a settings gear in the top left corner or something? 
- re-examine harness, make sure that the models receive all the proper info they need. e.g. past hands and past actions, or summaries of past play for each player. since play style matters, and an 'all in every time' strategy shouldn't dominate. also make sure that a model never ever discloses their hand in the chat. 

p1
- integrate voice into the poker game. real time voice + tool calls to take game actions. players can talk in turn, but can also interrupt each other. maybe need a talking stick + queue system to handle this well. try to make the table talk feel as lifelike and normal as possible, emulating a casual home game. don't just have a strict turn based thing, that's a bit boring. but also don't let them chat forever before moving onto the next turn.
- add table talk / chat to the harness so it impacts decision making, just like how it does in real life (e.g. daniel negraunu)



p2
- Wire up real time audio to chess game
- Enhance dialogue: when illegal mode is off and a model hits a retry, show an indicator in all caps and a different font. When illegal mode is on and an illegal move is played, in addition to the move showing red in the move history, prefix the dialogue with "ILLEGAL MOVE!" in red all caps before the model's line.
