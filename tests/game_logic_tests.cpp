#include "../src/main.cpp"

#include <stdexcept>

struct GameLogicTestAccess {
    static void login(GameHub& hub, const std::string& id, const std::string& account) {
        hub.login_locked(id, account);
    }

    static bool authenticated(const GameHub& hub, const std::string& id) {
        return hub.session_account_.contains(id);
    }

    static void set_address(GameHub& hub, const std::string& id, const std::string& address) {
        hub.session_address_[id] = address;
    }

    static int failures(const GameHub& hub, const std::string& address) {
        auto found = hub.login_guards_.find(address);
        return found == hub.login_guards_.end() ? 0 : found->second.failures;
    }

    static bool has_room(const GameHub& hub, const std::string& room_id) {
        return hub.rooms_.contains(room_id);
    }

    static void join(GameHub& hub, const std::string& id, const std::string& room_id) {
        if (hub.rooms_.contains(room_id)) hub.join_room_locked(id, room_id, id);
        else hub.create_room_locked(id, room_id, id, "");
    }

    static void join_with_invite(
        GameHub& hub, const std::string& id, const std::string& room_id, const std::string& invite) {
        hub.join_room_locked(id, room_id, id, invite);
    }

    static void create_with_invite(
        GameHub& hub, const std::string& id, const std::string& room_id, const std::string& invite) {
        hub.create_room_locked(id, room_id, id, invite);
    }

    static Room& room(GameHub& hub, const std::string& room_id) {
        return hub.rooms_.at(room_id);
    }

    static Room& add_room(GameHub& hub, std::string id, Room room) {
        room.id = id;
        return hub.rooms_.insert_or_assign(std::move(id), std::move(room)).first->second;
    }

    static void attach(GameHub& hub, const std::string& player_id, const std::string& room_id) {
        hub.session_room_[player_id] = room_id;
    }

    static bool can_raise(const GameHub& hub, const Room& room, const Player& player) {
        return hub.can_raise_locked(room, player);
    }

    static void action(GameHub& hub, const std::string& id, std::string action, int amount = 0) {
        hub.action_locked(id, std::move(action), amount);
    }

    static void start(GameHub& hub, const std::string& id, Room& room) {
        hub.start_locked(id, room);
    }

    static void set_mode(GameHub& hub, const std::string& id, std::string mode) {
        hub.set_mode_locked(id, std::move(mode));
    }

    static void set_ante(GameHub& hub, const std::string& id, int amount) {
        hub.set_ante_locked(id, amount);
    }

    static void transfer(GameHub& hub, const std::string& from, const std::string& to, int amount) {
        hub.transfer_chips_locked(from, to, amount);
    }

    static void sit_out(GameHub& hub, const std::string& id) {
        hub.set_sitting_out_locked(id, true);
    }

    static void leave(GameHub& hub, const std::string& id, const std::string& room_id) {
        hub.leave_room_locked(id, room_id);
    }

    static void next_phase(GameHub& hub, Room& room) {
        hub.next_phase_locked(room);
    }

    static void settle(GameHub& hub, Room& room) {
        hub.settle_showdown_locked(room, "test");
    }
};

static Card card(int rank, char suit) {
    return Card{rank, suit};
}

static Player player(std::string id, int chips = 1000) {
    Player result;
    result.id = std::move(id);
    result.name = result.id;
    result.chips = chips;
    return result;
}

static void require(bool condition, std::string_view message) {
    if (!condition) throw std::runtime_error(std::string(message));
}

static void test_hand_rankings() {
    const std::array<Card, 5> straight_flush = {
        card(14, 's'), card(13, 's'), card(12, 's'), card(11, 's'), card(10, 's')};
    const std::array<Card, 5> four = {
        card(9, 's'), card(9, 'h'), card(9, 'd'), card(9, 'c'), card(14, 's')};
    const std::array<Card, 5> full_house = {
        card(13, 's'), card(13, 'h'), card(13, 'd'), card(8, 'c'), card(8, 's')};
    const std::array<Card, 5> flush = {
        card(14, 'h'), card(11, 'h'), card(9, 'h'), card(7, 'h'), card(6, 'h')};
    const std::array<Card, 5> straight = {
        card(10, 's'), card(9, 'h'), card(8, 'd'), card(7, 'c'), card(6, 's')};
    const std::array<Card, 5> three = {
        card(12, 's'), card(12, 'h'), card(12, 'd'), card(8, 'c'), card(6, 's')};

    require(evaluate_five_cards(straight_flush, GameMode::Holdem)
        > evaluate_five_cards(four, GameMode::Holdem), "holdem: straight flush must beat four of a kind");
    require(evaluate_five_cards(full_house, GameMode::Holdem)
        > evaluate_five_cards(flush, GameMode::Holdem), "holdem: full house must beat flush");
    require(evaluate_five_cards(straight, GameMode::Holdem)
        > evaluate_five_cards(three, GameMode::Holdem), "holdem: straight must beat three of a kind");
    require(evaluate_five_cards(flush, GameMode::ShortDeck)
        > evaluate_five_cards(full_house, GameMode::ShortDeck), "short deck: flush must beat full house");
    require(evaluate_five_cards(three, GameMode::ShortDeck)
        > evaluate_five_cards(straight, GameMode::ShortDeck), "short deck: three of a kind must beat straight");

    const std::array<Card, 5> short_wheel = {
        card(14, 's'), card(9, 'h'), card(8, 'd'), card(7, 'c'), card(6, 's')};
    require(straight_high_from_counts([&] {
        std::array<int, 15> counts{};
        for (const auto& item : short_wheel) ++counts[item.rank];
        return counts;
    }(), GameMode::ShortDeck) == 9, "short deck: A-6-7-8-9 must be a nine-high straight");

    const auto best = evaluate_best_hand_result({
        card(14, 's'), card(13, 's'), card(12, 's'), card(11, 's'),
        card(10, 's'), card(2, 'h'), card(2, 'd')}, GameMode::Holdem);
    require(best.cards.size() == 5 && hand_category_text(best.value, GameMode::Holdem) == "同花顺",
        "showdown evaluation must retain the exact best five-card combination");
}

static void test_heads_up_big_blind_round_transition() {
    GameHub hub{"123456"};
    GameLogicTestAccess::join(hub, "a", "r");
    GameLogicTestAccess::join(hub, "b", "r");
    Room& room = GameLogicTestAccess::room(hub, "r");
    GameLogicTestAccess::start(hub, "a", room);

    require(room.phase == Phase::Preflop && room.players[room.current].id == "b",
        "heads-up preflop action must start with the dealer/small blind");
    GameLogicTestAccess::action(hub, "b", "call");
    require(room.players[room.current].id == "a", "the big blind must receive its preflop option");
    GameLogicTestAccess::action(hub, "a", "check");
    require(room.phase == Phase::Flop && room.players[room.current].id == "a",
        "one big-blind check must end preflop; the same player then acts first on the new flop round");
}

static void test_chip_transfer_integrity() {
    GameHub hub{"123456"};
    GameLogicTestAccess::join(hub, "a", "r");
    GameLogicTestAccess::join(hub, "b", "r");
    Room& room = GameLogicTestAccess::room(hub, "r");
    GameLogicTestAccess::transfer(hub, "a", "b", 750);
    require(room.players[0].chips == 1250 && room.players[1].chips == 2750,
        "chip transfer must debit and credit the exact same amount");
    GameLogicTestAccess::transfer(hub, "a", "b", 2000);
    require(room.players[0].chips == 1250 && room.players[1].chips == 2750,
        "a transfer larger than the sender's stack must not change either balance");
}

static void test_ante_holdem_posts_every_player_without_blinds() {
    GameHub hub{"123456"};
    GameLogicTestAccess::join(hub, "a", "r");
    GameLogicTestAccess::join(hub, "b", "r");
    GameLogicTestAccess::join(hub, "c", "r");
    Room& room = GameLogicTestAccess::room(hub, "r");

    GameLogicTestAccess::set_mode(hub, "a", "ante");
    GameLogicTestAccess::set_ante(hub, "b", 99);
    require(room.ante == 20, "a non-host must not be allowed to change the ante");
    GameLogicTestAccess::set_ante(hub, "a", 50);
    GameLogicTestAccess::start(hub, "a", room);

    require(room.mode == GameMode::AnteHoldem && room.ante == 50,
        "the host must be able to configure ante holdem");
    require(room.pot == 150 && room.highest_bet == 0,
        "all three antes must enter the pot without creating a current-round bet");
    require(room.small_blind_index == -1 && room.big_blind_index == -1,
        "ante holdem must not assign small or big blinds");
    for (const auto& player : room.players) {
        require(player.chips == 1950 && player.committed == 50 && player.bet == 0,
            "each player must post the exact ante while keeping round bet at zero");
    }
    require(room.players[room.current].id == "c",
        "ante holdem preflop action must start to the left of the dealer");
}

static void test_private_access_code_and_rate_limit() {
    GameHub hub{"123456"};
    for (int i = 0; i < 5; ++i) {
        const std::string id = "bad" + std::to_string(i);
        GameLogicTestAccess::set_address(hub, id, "192.0.2.10");
        GameLogicTestAccess::login(hub, id, "000000");
        require(!GameLogicTestAccess::authenticated(hub, id),
            "an incorrect private access code must be rejected");
    }
    require(GameLogicTestAccess::failures(hub, "192.0.2.10") == 5,
        "five consecutive failures from one address must trigger the limiter");

    GameLogicTestAccess::set_address(hub, "blocked", "192.0.2.10");
    GameLogicTestAccess::login(hub, "blocked", "123456");
    require(!GameLogicTestAccess::authenticated(hub, "blocked"),
        "a locked source must remain blocked even when it later submits the correct code");

    GameLogicTestAccess::set_address(hub, "invited", "192.0.2.11");
    GameLogicTestAccess::login(hub, "invited", "123456");
    require(GameLogicTestAccess::authenticated(hub, "invited"),
        "the configured private access code must allow an invited source to log in");

    GameHub reset_hub{"654321"};
    GameLogicTestAccess::set_address(reset_hub, "wrong", "192.0.2.12");
    GameLogicTestAccess::login(reset_hub, "wrong", "111111");
    GameLogicTestAccess::set_address(reset_hub, "right", "192.0.2.12");
    GameLogicTestAccess::login(reset_hub, "right", "654321");
    require(GameLogicTestAccess::authenticated(reset_hub, "right")
        && GameLogicTestAccess::failures(reset_hub, "192.0.2.12") == 0,
        "a successful login must clear prior failures for that source");

    GameHub gated_hub{"654321"};
    gated_hub.on_message("guest", "{\"type\":\"create-room\",\"room\":\"r\",\"name\":\"guest\"}");
    require(!GameLogicTestAccess::has_room(gated_hub, "r"),
        "an unauthenticated session must not be allowed to join a room");
    GameLogicTestAccess::login(gated_hub, "guest", "654321");
    gated_hub.on_message("guest", "{\"type\":\"create-room\",\"room\":\"r\",\"name\":\"guest\"}");
    require(GameLogicTestAccess::has_room(gated_hub, "r"),
        "an authenticated session must be allowed to join a room");
}

static void test_raise_reopening() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::Preflop;
    room.players = {player("a"), player("b"), player("c")};
    room.highest_bet = 150;
    room.min_raise = 100;
    room.last_action_bet["a"] = 100;

    require(!GameLogicTestAccess::can_raise(hub, room, room.players[0]),
        "a short all-in must not immediately reopen a prior caller's raise right");
    room.highest_bet = 200;
    require(GameLogicTestAccess::can_raise(hub, room, room.players[0]),
        "cumulative short raises reaching a full raise must reopen raising");

    room.highest_bet = 10;
    room.last_action_bet["a"] = 0;
    room.checked.insert("a");
    require(GameLogicTestAccess::can_raise(hub, room, room.players[0]),
        "a player who checked must be allowed to raise a later short opening bet");
}

static void test_host_permissions_and_succession() {
    GameHub hub{"123456"};
    GameLogicTestAccess::join(hub, "a", "r");
    GameLogicTestAccess::join(hub, "b", "r");
    Room& room = GameLogicTestAccess::room(hub, "r");

    require(room.host_id == "a", "the first player joining a room must become host");
    GameLogicTestAccess::set_mode(hub, "b", "shortdeck");
    require(room.mode == GameMode::Holdem, "a non-host must not be allowed to change game mode");
    GameLogicTestAccess::start(hub, "b", room);
    require(room.phase == Phase::Waiting, "a non-host must not be allowed to start a hand");
    GameLogicTestAccess::set_mode(hub, "a", "shortdeck");
    require(room.mode == GameMode::ShortDeck, "the host must be allowed to change game mode");

    GameHub succession_hub{"123456"};
    GameLogicTestAccess::join(succession_hub, "a", "r");
    GameLogicTestAccess::join(succession_hub, "b", "r");
    GameLogicTestAccess::join(succession_hub, "c", "r");
    GameLogicTestAccess::leave(succession_hub, "a", "r");
    require(GameLogicTestAccess::room(succession_hub, "r").host_id == "b",
        "host ownership must pass to the next online player when the host leaves");
}

static void test_private_room_invite() {
    GameHub hub{"123456"};
    GameLogicTestAccess::create_with_invite(hub, "host", "private", "A1B2C3");
    Room& room = GameLogicTestAccess::room(hub, "private");
    require(room.host_id == "host" && room.invite_code == "A1B2C3",
        "a private room must retain its creator and invite code");

    GameLogicTestAccess::join_with_invite(hub, "stranger", "private", "wrong1");
    require(room.players.size() == 1, "an incorrect room invite must be rejected");
    GameLogicTestAccess::join_with_invite(hub, "friend", "private", "A1B2C3");
    require(room.players.size() == 2 && room.players[1].id == "friend",
        "the correct room invite must allow a player to join");
}

static void test_raise_cannot_disguise_short_call() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::Preflop;
    room.players = {player("a", 50), player("b", 1000)};
    room.current = 0;
    room.highest_bet = 100;
    room.min_raise = 100;
    Room& stored = GameLogicTestAccess::add_room(hub, "r", std::move(room));
    GameLogicTestAccess::attach(hub, "a", "r");

    GameLogicTestAccess::action(hub, "a", "raise", 1000);
    require(stored.players[0].chips == 50 && stored.players[0].bet == 0 && stored.pot == 0,
        "an oversized raise request must not be clamped into an under-call");
}

static void test_sit_out_action_order() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::Flop;
    room.players = {player("a"), player("b"), player("c")};
    room.current = 0;
    Room& stored = GameLogicTestAccess::add_room(hub, "r", std::move(room));
    GameLogicTestAccess::attach(hub, "b", "r");

    GameLogicTestAccess::sit_out(hub, "b");
    require(stored.players[1].folded, "sitting out during a hand must fold the player");
    require(stored.current == 0, "a non-current player sitting out must not skip the current actor");

    stored.players[1].sitting_out = false;
    stored.players[1].folded = false;
    stored.current = 1;
    GameLogicTestAccess::sit_out(hub, "b");
    require(stored.current == 2, "the current actor sitting out must advance action");
}

static void test_departure_preserves_committed_chips() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::Flop;
    room.pot = 300;
    room.current = 1;
    room.players = {player("a"), player("b"), player("c")};
    for (auto& item : room.players) item.committed = 100;
    Room& stored = GameLogicTestAccess::add_room(hub, "r", std::move(room));

    GameLogicTestAccess::leave(hub, "a", "r");
    require(stored.players.size() == 3, "a departed in-hand player must remain until settlement");
    require(!stored.players[0].present && stored.players[0].folded,
        "a departed player with pending decisions must be marked absent and folded");
    require(stored.players[0].committed == 100 && stored.pot == 300,
        "departure must preserve committed chips and the pot");
}

static void test_disconnected_all_in_remains_eligible() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::Turn;
    room.current = 1;
    room.players = {player("a", 0), player("b"), player("c")};
    room.players[0].all_in = true;
    room.players[0].committed = 100;
    Room& stored = GameLogicTestAccess::add_room(hub, "r", std::move(room));

    GameLogicTestAccess::leave(hub, "a", "r");
    require(!stored.players[0].present && !stored.players[0].folded,
        "a disconnected all-in player must remain eligible for showdown");
}

static void test_side_pots() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::River;
    room.mode = GameMode::Holdem;
    room.pot = 600;
    room.community = {card(2, 's'), card(3, 'h'), card(4, 'd'), card(9, 'c'), card(13, 'c')};
    room.players = {player("a", 0), player("b", 0), player("c", 0)};
    room.players[0].committed = 100;
    room.players[0].hole = {card(14, 's'), card(5, 's')};
    room.players[1].committed = 200;
    room.players[1].hole = {card(13, 'h'), card(13, 'd')};
    room.players[2].committed = 300;
    room.players[2].hole = {card(12, 'h'), card(12, 'd')};

    GameLogicTestAccess::settle(hub, room);
    require(room.players[0].chips == 300, "main pot must go to the best eligible hand");
    require(room.players[1].chips == 200, "first side pot must go to its best eligible hand");
    require(room.players[2].chips == 100, "unmatched final side-pot layer must return to its contributor");
    require(room.phase == Phase::Waiting && room.pot == 0, "settlement must finish the hand");
}

static void test_automatic_runout() {
    GameHub hub{"123456"};
    Room room;
    room.phase = Phase::Preflop;
    room.pot = 200;
    room.players = {player("a", 100), player("b", 0)};
    room.players[0].committed = 100;
    room.players[0].hole = {card(14, 's'), card(14, 'h')};
    room.players[1].committed = 100;
    room.players[1].all_in = true;
    room.players[1].hole = {card(13, 's'), card(13, 'h')};
    room.deck = {card(2, 's'), card(3, 'h'), card(4, 'd'), card(8, 'c'), card(9, 's')};

    GameLogicTestAccess::next_phase(hub, room);
    require(room.phase == Phase::Waiting, "only one actionable player must trigger an automatic runout");
    require(room.community.size() == 5, "automatic runout must deal all five community cards");
    require(room.players[0].chips + room.players[1].chips == 300,
        "automatic runout must preserve the total chip count");
}

int main() {
    try {
        test_hand_rankings();
        test_heads_up_big_blind_round_transition();
        test_chip_transfer_integrity();
        test_ante_holdem_posts_every_player_without_blinds();
        test_private_access_code_and_rate_limit();
        test_host_permissions_and_succession();
        test_private_room_invite();
        test_raise_reopening();
        test_raise_cannot_disguise_short_call();
        test_sit_out_action_order();
        test_departure_preserves_committed_chips();
        test_disconnected_all_in_remains_eligible();
        test_side_pots();
        test_automatic_runout();
        std::cout << "All game logic tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Game logic test failed: " << error.what() << "\n";
        return 1;
    }
}
