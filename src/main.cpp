#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/beast/websocket.hpp>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
using tcp = asio::ip::tcp;

static std::string web_root() {
#ifdef WEB_ROOT
    return WEB_ROOT;
#else
    return "./web";
#endif
}

static std::string json_escape(std::string_view input) {
    std::string out;
    out.reserve(input.size() + 8);
    for (char c : input) {
        switch (c) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c; break;
        }
    }
    return out;
}

static std::optional<std::string> json_string(std::string_view body, std::string_view key) {
    const std::string needle = "\"" + std::string(key) + "\"";
    size_t pos = body.find(needle);
    if (pos == std::string_view::npos) return std::nullopt;
    pos = body.find(':', pos + needle.size());
    if (pos == std::string_view::npos) return std::nullopt;
    pos = body.find('"', pos + 1);
    if (pos == std::string_view::npos) return std::nullopt;
    std::string value;
    bool escape = false;
    for (size_t i = pos + 1; i < body.size(); ++i) {
        char c = body[i];
        if (escape) {
            switch (c) {
                case 'n': value += '\n'; break;
                case 'r': value += '\r'; break;
                case 't': value += '\t'; break;
                default: value += c; break;
            }
            escape = false;
            continue;
        }
        if (c == '\\') {
            escape = true;
            continue;
        }
        if (c == '"') return value;
        value += c;
    }
    return std::nullopt;
}

static int json_int(std::string_view body, std::string_view key, int fallback = 0) {
    const std::string needle = "\"" + std::string(key) + "\"";
    size_t pos = body.find(needle);
    if (pos == std::string_view::npos) return fallback;
    pos = body.find(':', pos + needle.size());
    if (pos == std::string_view::npos) return fallback;
    ++pos;
    while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) ++pos;
    int sign = 1;
    if (pos < body.size() && body[pos] == '-') {
        sign = -1;
        ++pos;
    }
    int value = 0;
    bool any = false;
    while (pos < body.size() && std::isdigit(static_cast<unsigned char>(body[pos]))) {
        any = true;
        value = value * 10 + (body[pos] - '0');
        ++pos;
    }
    return any ? value * sign : fallback;
}

static bool json_bool(std::string_view body, std::string_view key, bool fallback = false) {
    const std::string needle = "\"" + std::string(key) + "\"";
    size_t pos = body.find(needle);
    if (pos == std::string_view::npos) return fallback;
    pos = body.find(':', pos + needle.size());
    if (pos == std::string_view::npos) return fallback;
    ++pos;
    while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) ++pos;
    if (body.substr(pos, 4) == "true") return true;
    if (body.substr(pos, 5) == "false") return false;
    return fallback;
}

struct Card {
    int rank = 2;
    char suit = 's';

    std::string text() const {
        static const std::array<std::string, 15> ranks = {
            "", "", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"
        };
        return ranks[rank] + suit;
    }
};

struct Player {
    std::string id;
    std::string name;
    int chips = 2000;
    int bet = 0;
    int committed = 0;
    bool folded = false;
    bool all_in = false;
    bool sitting_out = false;
    std::vector<Card> hole;
};

enum class Phase { Waiting, Preflop, Flop, Turn, River, Showdown };
enum class GameMode { Holdem, ShortDeck };

struct Room {
    std::string id;
    std::vector<Player> players;
    std::vector<Card> deck;
    std::vector<Card> community;
    Phase phase = Phase::Waiting;
    int dealer = 0;
    int current = 0;
    int highest_bet = 0;
    int min_raise = 20;
    int pot = 0;
    int small_blind = 10;
    int big_blind = 20;
    GameMode mode = GameMode::Holdem;
    std::set<std::string> acted;
};

class WsSession;

class GameHub {
public:
    std::string add_session(std::shared_ptr<WsSession> session);
    void remove_session(const std::string& id);
    void on_message(const std::string& id, const std::string& text);
    void send_to(const std::string& id, const std::string& text);

private:
    std::mutex mutex_;
    std::unordered_map<std::string, std::weak_ptr<WsSession>> sessions_;
    std::unordered_map<std::string, std::string> session_room_;
    std::unordered_map<std::string, Room> rooms_;
    std::atomic_uint64_t next_id_{1};

    std::string make_id();
    void join_room_locked(const std::string& id, std::string room_id, std::string name);
    void start_locked(Room& room);
    void action_locked(const std::string& id, std::string action, int amount);
    void set_mode_locked(const std::string& id, std::string mode);
    void set_sitting_out_locked(const std::string& id, bool sitting_out);
    void transfer_chips_locked(const std::string& id, std::string to, int amount);
    void advance_after_action_locked(Room& room);
    void next_phase_locked(Room& room);
    std::vector<int> playable_indices_locked(const Room& room) const;
    int next_playable_after_locked(const Room& room, int from) const;
    int next_pending_actor_after_locked(const Room& room, int from) const;
    bool has_pending_actor_locked(const Room& room) const;
    void runout_to_showdown_locked(Room& room);
    void settle_showdown_locked(Room& room, std::string reason);
    void finish_hand_locked(Room& room);
    void broadcast_locked(const Room& room, const std::string& text);
    void emit_state_locked(const Room& room);
    void emit_event_locked(const Room& room, std::string message);
    Player* find_player(Room& room, const std::string& id);
};

class WsSession : public std::enable_shared_from_this<WsSession> {
public:
    WsSession(tcp::socket socket, GameHub& hub)
        : ws_(std::move(socket)), hub_(hub) {}

    void run(http::request<http::string_body> req) {
        ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
        ws_.set_option(websocket::stream_base::decorator([](websocket::response_type& res) {
            res.set(http::field::server, "web-texas-webrtc");
        }));
        ws_.accept(req);
        id_ = hub_.add_session(shared_from_this());
        send("{\"type\":\"hello\",\"id\":\"" + json_escape(id_) + "\"}");
        read_loop();
    }

    void send(std::string text) {
        asio::post(ws_.get_executor(), [self = shared_from_this(), text = std::move(text)]() mutable {
            bool writing = !self->outbox_.empty();
            self->outbox_.push_back(std::move(text));
            if (!writing) self->write_next();
        });
    }

private:
    websocket::stream<tcp::socket> ws_;
    GameHub& hub_;
    beast::flat_buffer buffer_;
    std::deque<std::string> outbox_;
    std::string id_;

    void read_loop() {
        ws_.async_read(buffer_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (ec) {
                self->hub_.remove_session(self->id_);
                return;
            }
            std::string text = beast::buffers_to_string(self->buffer_.data());
            self->buffer_.consume(self->buffer_.size());
            self->hub_.on_message(self->id_, text);
            self->read_loop();
        });
    }

    void write_next() {
        ws_.text(true);
        ws_.async_write(asio::buffer(outbox_.front()), [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (ec) {
                self->hub_.remove_session(self->id_);
                return;
            }
            self->outbox_.pop_front();
            if (!self->outbox_.empty()) self->write_next();
        });
    }
};

static std::string mode_text(GameMode mode) {
    return mode == GameMode::ShortDeck ? "shortdeck" : "holdem";
}

static GameMode parse_mode(std::string mode) {
    std::transform(mode.begin(), mode.end(), mode.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return mode == "shortdeck" || mode == "short" || mode == "6plus" ? GameMode::ShortDeck : GameMode::Holdem;
}

static std::vector<Card> new_deck(GameMode mode) {
    std::vector<Card> deck;
    const int low_rank = mode == GameMode::ShortDeck ? 6 : 2;
    for (char suit : std::array<char, 4>{'s', 'h', 'd', 'c'}) {
        for (int rank = low_rank; rank <= 14; ++rank) deck.push_back(Card{rank, suit});
    }
    std::mt19937 rng(std::random_device{}());
    std::shuffle(deck.begin(), deck.end(), rng);
    return deck;
}

static std::string phase_text(Phase phase) {
    switch (phase) {
        case Phase::Waiting: return "waiting";
        case Phase::Preflop: return "preflop";
        case Phase::Flop: return "flop";
        case Phase::Turn: return "turn";
        case Phase::River: return "river";
        case Phase::Showdown: return "showdown";
    }
    return "waiting";
}

static uint64_t pack_hand(int category, std::vector<int> ranks) {
    uint64_t value = static_cast<uint64_t>(category);
    while (ranks.size() < 5) ranks.push_back(0);
    for (int rank : ranks) {
        value = (value << 4) | static_cast<uint64_t>(rank);
    }
    return value;
}

static int straight_high_from_counts(const std::array<int, 15>& counts, GameMode mode) {
    for (int high = 14; high >= 5; --high) {
        bool ok = true;
        for (int offset = 0; offset < 5; ++offset) {
            if (counts[high - offset] == 0) {
                ok = false;
                break;
            }
        }
        if (ok) return high;
    }
    if (mode == GameMode::ShortDeck && counts[14] && counts[9] && counts[8] && counts[7] && counts[6]) return 9;
    if (counts[14] && counts[5] && counts[4] && counts[3] && counts[2]) return 5;
    return 0;
}

static int hand_category_rank(GameMode mode, std::string_view kind) {
    if (kind == "straight_flush") return 8;
    if (kind == "four") return 7;
    if (mode == GameMode::ShortDeck) {
        if (kind == "flush") return 6;
        if (kind == "full_house") return 5;
        if (kind == "three") return 4;
        if (kind == "straight") return 3;
    } else {
        if (kind == "full_house") return 6;
        if (kind == "flush") return 5;
        if (kind == "straight") return 4;
        if (kind == "three") return 3;
    }
    if (kind == "two_pair") return 2;
    if (kind == "pair") return 1;
    return 0;
}

static uint64_t evaluate_five_cards(const std::array<Card, 5>& cards, GameMode mode) {
    std::array<int, 15> counts{};
    std::map<char, int> suits;
    for (const auto& card : cards) {
        ++counts[card.rank];
        ++suits[card.suit];
    }

    const bool flush = std::any_of(suits.begin(), suits.end(), [](const auto& item) {
        return item.second == 5;
    });
    const int straight_high = straight_high_from_counts(counts, mode);

    if (flush && straight_high) return pack_hand(hand_category_rank(mode, "straight_flush"), {straight_high});

    std::vector<int> fours;
    std::vector<int> threes;
    std::vector<int> pairs;
    std::vector<int> singles;
    for (int rank = 14; rank >= 2; --rank) {
        if (counts[rank] == 4) fours.push_back(rank);
        else if (counts[rank] == 3) threes.push_back(rank);
        else if (counts[rank] == 2) pairs.push_back(rank);
        else if (counts[rank] == 1) singles.push_back(rank);
    }

    if (!fours.empty()) return pack_hand(hand_category_rank(mode, "four"), {fours[0], singles[0]});
    if (!threes.empty() && (!pairs.empty() || threes.size() > 1)) {
        int pair_rank = !pairs.empty() ? pairs[0] : threes[1];
        return pack_hand(hand_category_rank(mode, "full_house"), {threes[0], pair_rank});
    }
    if (flush) {
        std::vector<int> ranks;
        for (int rank = 14; rank >= 2; --rank) {
            for (int count = 0; count < counts[rank]; ++count) ranks.push_back(rank);
        }
        return pack_hand(hand_category_rank(mode, "flush"), ranks);
    }
    if (straight_high) return pack_hand(hand_category_rank(mode, "straight"), {straight_high});
    if (!threes.empty()) {
        std::vector<int> ranks = {threes[0]};
        ranks.insert(ranks.end(), singles.begin(), singles.end());
        return pack_hand(hand_category_rank(mode, "three"), ranks);
    }
    if (pairs.size() >= 2) return pack_hand(hand_category_rank(mode, "two_pair"), {pairs[0], pairs[1], singles[0]});
    if (pairs.size() == 1) {
        std::vector<int> ranks = {pairs[0]};
        ranks.insert(ranks.end(), singles.begin(), singles.end());
        return pack_hand(hand_category_rank(mode, "pair"), ranks);
    }
    return pack_hand(0, singles);
}

static uint64_t evaluate_best_hand(const std::vector<Card>& cards, GameMode mode) {
    if (cards.size() < 5) return 0;
    uint64_t best = 0;
    for (size_t a = 0; a + 4 < cards.size(); ++a) {
        for (size_t b = a + 1; b + 3 < cards.size(); ++b) {
            for (size_t c = b + 1; c + 2 < cards.size(); ++c) {
                for (size_t d = c + 1; d + 1 < cards.size(); ++d) {
                    for (size_t e = d + 1; e < cards.size(); ++e) {
                        best = std::max(best, evaluate_five_cards({cards[a], cards[b], cards[c], cards[d], cards[e]}, mode));
                    }
                }
            }
        }
    }
    return best;
}

static std::string hand_category_text(uint64_t value, GameMode mode) {
    const int category = static_cast<int>(value >> 20);
    if (mode == GameMode::ShortDeck) {
        static const std::array<std::string, 9> names = {
            "高牌", "一对", "两对", "顺子", "三条", "葫芦", "同花", "四条", "同花顺"
        };
        if (category < 0 || category >= static_cast<int>(names.size())) return "未知牌型";
        return names[category];
    }
    static const std::array<std::string, 9> names = {
        "高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"
    };
    if (category < 0 || category >= static_cast<int>(names.size())) return "未知牌型";
    return names[category];
}

std::string GameHub::make_id() {
    return "p" + std::to_string(next_id_.fetch_add(1));
}

std::string GameHub::add_session(std::shared_ptr<WsSession> session) {
    std::lock_guard lock(mutex_);
    std::string id = make_id();
    sessions_[id] = session;
    return id;
}

void GameHub::remove_session(const std::string& id) {
    std::lock_guard lock(mutex_);
    auto room_it = session_room_.find(id);
    if (room_it != session_room_.end()) {
        auto r = rooms_.find(room_it->second);
        if (r != rooms_.end()) {
            auto& players = r->second.players;
            auto old_size = players.size();
            players.erase(std::remove_if(players.begin(), players.end(), [&](const Player& p) { return p.id == id; }), players.end());
            if (players.size() != old_size) {
                broadcast_locked(r->second, "{\"type\":\"peer-left\",\"id\":\"" + json_escape(id) + "\"}");
                if (players.empty()) {
                    rooms_.erase(r);
                } else {
                    r->second.current %= static_cast<int>(players.size());
                    r->second.dealer %= static_cast<int>(players.size());
                    emit_state_locked(r->second);
                }
            }
        }
        session_room_.erase(room_it);
    }
    sessions_.erase(id);
}

void GameHub::on_message(const std::string& id, const std::string& text) {
    std::lock_guard lock(mutex_);
    const auto type = json_string(text, "type").value_or("");
    if (type == "join") {
        join_room_locked(id, json_string(text, "room").value_or("demo"), json_string(text, "name").value_or(id));
    } else if (type == "start") {
        auto it = session_room_.find(id);
        if (it != session_room_.end()) start_locked(rooms_[it->second]);
    } else if (type == "action") {
        action_locked(id, json_string(text, "action").value_or("check"), json_int(text, "amount", 0));
    } else if (type == "mode") {
        set_mode_locked(id, json_string(text, "mode").value_or("holdem"));
    } else if (type == "sitout") {
        set_sitting_out_locked(id, json_bool(text, "sittingOut", true));
    } else if (type == "transfer") {
        transfer_chips_locked(id, json_string(text, "to").value_or(""), json_int(text, "amount", 0));
    }
}

void GameHub::send_to(const std::string& id, const std::string& text) {
    std::shared_ptr<WsSession> session;
    {
        std::lock_guard lock(mutex_);
        auto it = sessions_.find(id);
        if (it != sessions_.end()) session = it->second.lock();
    }
    if (session) session->send(text);
}

Player* GameHub::find_player(Room& room, const std::string& id) {
    for (auto& player : room.players) {
        if (player.id == id) return &player;
    }
    return nullptr;
}

void GameHub::join_room_locked(const std::string& id, std::string room_id, std::string name) {
    if (room_id.empty()) room_id = "demo";
    if (name.empty()) name = id;

    auto current_room = session_room_.find(id);
    if (current_room != session_room_.end() && current_room->second != room_id) {
        auto old_room = rooms_.find(current_room->second);
        if (old_room != rooms_.end()) {
            auto& old_players = old_room->second.players;
            old_players.erase(std::remove_if(old_players.begin(), old_players.end(), [&](const Player& p) {
                return p.id == id;
            }), old_players.end());
            broadcast_locked(old_room->second, "{\"type\":\"peer-left\",\"id\":\"" + json_escape(id) + "\"}");
            if (old_players.empty()) {
                rooms_.erase(old_room);
            } else {
                old_room->second.current %= static_cast<int>(old_players.size());
                old_room->second.dealer %= static_cast<int>(old_players.size());
                emit_state_locked(old_room->second);
            }
        }
    }

    Room& room = rooms_[room_id];
    room.id = room_id;
    session_room_[id] = room_id;

    if (auto* existing = find_player(room, id)) {
        existing->name = name.substr(0, 24);
    } else {
        Player player;
        player.id = id;
        player.name = name.substr(0, 24);
        room.players.push_back(player);
    }

    if (auto it = sessions_.find(id); it != sessions_.end()) {
        if (auto session = it->second.lock()) {
            session->send("{\"type\":\"welcome\",\"id\":\"" + json_escape(id) + "\",\"room\":\"" + json_escape(room_id) + "\"}");
        }
    }
    broadcast_locked(room, "{\"type\":\"peer-joined\",\"id\":\"" + json_escape(id) + "\",\"name\":\"" + json_escape(name) + "\"}");
    emit_state_locked(room);
}

void GameHub::start_locked(Room& room) {
    if (room.phase != Phase::Waiting) {
        emit_event_locked(room, "当前牌局尚未结束");
        return;
    }

    const auto playable = playable_indices_locked(room);
    if (playable.size() < 2) {
        emit_event_locked(room, "至少需要 2 名可参局玩家开局");
        return;
    }

    room.deck = new_deck(room.mode);
    room.community.clear();
    room.phase = Phase::Preflop;
    room.highest_bet = room.big_blind;
    room.min_raise = room.big_blind;
    room.pot = 0;
    room.acted.clear();

    for (auto& p : room.players) {
        p.bet = 0;
        p.committed = 0;
        p.folded = true;
        p.all_in = false;
        p.hole.clear();
    }

    for (int index : playable) {
        auto& p = room.players[index];
        p.folded = false;
        p.hole.push_back(room.deck.back()); room.deck.pop_back();
        p.hole.push_back(room.deck.back()); room.deck.pop_back();
    }

    room.dealer = next_playable_after_locked(room, room.dealer);
    const int sb = playable.size() == 2 ? room.dealer : next_playable_after_locked(room, room.dealer);
    const int bb = next_playable_after_locked(room, sb);
    auto post = [&](int index, int amount) {
        int paid = std::min(room.players[index].chips, amount);
        room.players[index].chips -= paid;
        room.players[index].bet += paid;
        room.players[index].committed += paid;
        room.pot += paid;
    };
    post(sb, room.small_blind);
    post(bb, room.big_blind);
    room.players[sb].all_in = room.players[sb].chips == 0;
    room.players[bb].all_in = room.players[bb].chips == 0;
    room.current = next_pending_actor_after_locked(room, bb);
    if (room.current < 0) {
        runout_to_showdown_locked(room);
    }

    emit_event_locked(room, "新牌局开始 (" + mode_text(room.mode) + ")");
    emit_state_locked(room);
}

void GameHub::set_mode_locked(const std::string& id, std::string mode) {
    auto room_name = session_room_.find(id);
    if (room_name == session_room_.end()) return;
    Room& room = rooms_[room_name->second];
    if (room.phase != Phase::Waiting) {
        emit_event_locked(room, "玩法只能在牌局等待状态切换");
        return;
    }
    room.mode = parse_mode(std::move(mode));
    emit_event_locked(room, "玩法切换为 " + std::string(room.mode == GameMode::ShortDeck ? "短牌" : "标准德州"));
    emit_state_locked(room);
}

void GameHub::set_sitting_out_locked(const std::string& id, bool sitting_out) {
    auto room_name = session_room_.find(id);
    if (room_name == session_room_.end()) return;
    Room& room = rooms_[room_name->second];
    Player* player = find_player(room, id);
    if (!player) return;

    player->sitting_out = sitting_out;
    emit_event_locked(room, player->name + (sitting_out ? " 暂离牌局，进入旁观" : " 回到牌局，下一手可参与"));

    if (sitting_out && room.phase != Phase::Waiting && !player->folded && !player->all_in) {
        player->folded = true;
        room.acted.insert(id);
        advance_after_action_locked(room);
    }

    emit_state_locked(room);
}

void GameHub::transfer_chips_locked(const std::string& id, std::string to, int amount) {
    auto room_name = session_room_.find(id);
    if (room_name == session_room_.end() || to.empty() || to == id || amount <= 0) return;
    Room& room = rooms_[room_name->second];
    if (room.phase != Phase::Waiting) {
        emit_event_locked(room, "筹码转移只能在牌局等待状态进行");
        return;
    }

    Player* from_player = find_player(room, id);
    Player* to_player = find_player(room, to);
    if (!from_player || !to_player || from_player->chips < amount) {
        emit_event_locked(room, "筹码转移失败");
        return;
    }

    from_player->chips -= amount;
    to_player->chips += amount;
    emit_event_locked(room, from_player->name + " 转移 " + std::to_string(amount) + " 筹码给 " + to_player->name);
    emit_state_locked(room);
}

void GameHub::action_locked(const std::string& id, std::string action, int amount) {
    auto room_name = session_room_.find(id);
    if (room_name == session_room_.end()) return;
    Room& room = rooms_[room_name->second];
    if (room.phase == Phase::Waiting || room.phase == Phase::Showdown || room.players.empty()) return;
    if (room.current < 0 || room.current >= static_cast<int>(room.players.size())) return;
    if (room.players[room.current].id != id) return;
    Player& p = room.players[room.current];
    if (p.sitting_out || p.folded || p.all_in) return;
    const int to_call = std::max(0, room.highest_bet - p.bet);
    const int stack_total = p.bet + p.chips;
    const int previous_highest = room.highest_bet;

    if (action == "fold") {
        p.folded = true;
    } else if (action == "check") {
        if (to_call != 0) return;
    } else if (action == "call") {
        if (to_call == 0) return;
        int paid = std::min(p.chips, to_call);
        p.chips -= paid;
        p.bet += paid;
        p.committed += paid;
        room.pot += paid;
        p.all_in = p.chips == 0;
    } else if (action == "raise") {
        const int min_target = room.highest_bet == 0 || room.highest_bet < room.big_blind
            ? room.big_blind
            : room.highest_bet + room.min_raise;
        int target = amount;
        if (target <= previous_highest) return;
        if (target < min_target && stack_total >= min_target) return;
        target = std::min(target, stack_total);
        if (target <= p.bet) return;
        int need = std::max(0, target - p.bet);
        p.chips -= need;
        p.bet += need;
        p.committed += need;
        room.pot += need;
        p.all_in = p.chips == 0;
        if (p.bet > room.highest_bet) {
            room.highest_bet = p.bet;
            const int raise_size = previous_highest < room.big_blind
                ? room.highest_bet
                : room.highest_bet - previous_highest;
            if (room.highest_bet >= min_target) {
                room.min_raise = std::max(room.big_blind, raise_size);
                room.acted.clear();
            }
        }
    } else {
        return;
    }

    room.acted.insert(id);
    emit_event_locked(room, p.name + " " + action);
    advance_after_action_locked(room);
    emit_state_locked(room);
}

std::vector<int> GameHub::playable_indices_locked(const Room& room) const {
    std::vector<int> indices;
    for (int i = 0; i < static_cast<int>(room.players.size()); ++i) {
        const auto& p = room.players[i];
        if (!p.sitting_out && p.chips > 0) indices.push_back(i);
    }
    return indices;
}

int GameHub::next_playable_after_locked(const Room& room, int from) const {
    const int n = static_cast<int>(room.players.size());
    if (n == 0) return -1;
    for (int step = 1; step <= n; ++step) {
        int next = (from + step + n) % n;
        const auto& p = room.players[next];
        if (!p.sitting_out && p.chips > 0) return next;
    }
    return -1;
}

int GameHub::next_pending_actor_after_locked(const Room& room, int from) const {
    const int n = static_cast<int>(room.players.size());
    if (n == 0) return -1;
    for (int step = 1; step <= n; ++step) {
        int next = (from + step + n) % n;
        const auto& p = room.players[next];
        if (!p.sitting_out && !p.folded && !p.all_in) return next;
    }
    return -1;
}

void GameHub::advance_after_action_locked(Room& room) {
    std::vector<int> active;
    for (int i = 0; i < static_cast<int>(room.players.size()); ++i) {
        if (!room.players[i].sitting_out && !room.players[i].folded) active.push_back(i);
    }
    if (active.size() == 1) {
        Player& winner = room.players[active[0]];
        winner.chips += room.pot;
        emit_event_locked(room, winner.name + " 赢得底池 " + std::to_string(room.pot));
        room.current = active[0];
        finish_hand_locked(room);
        return;
    }

    bool round_done = true;
    for (auto& p : room.players) {
        if (p.sitting_out || p.folded || p.all_in) continue;
        if (!room.acted.contains(p.id) || p.bet != room.highest_bet) {
            round_done = false;
            break;
        }
    }
    if (round_done) {
        next_phase_locked(room);
        return;
    }

    if (!has_pending_actor_locked(room)) {
        runout_to_showdown_locked(room);
        return;
    }

    int next = next_pending_actor_after_locked(room, room.current);
    if (next >= 0) {
        room.current = next;
        return;
    }
    next_phase_locked(room);
}

void GameHub::next_phase_locked(Room& room) {
    for (auto& p : room.players) p.bet = 0;
    room.highest_bet = 0;
    room.min_raise = room.big_blind;
    room.acted.clear();

    auto draw = [&]() {
        if (!room.deck.empty()) {
            room.community.push_back(room.deck.back());
            room.deck.pop_back();
        }
    };

    if (room.phase == Phase::Preflop) {
        draw(); draw(); draw();
        room.phase = Phase::Flop;
    } else if (room.phase == Phase::Flop) {
        draw();
        room.phase = Phase::Turn;
    } else if (room.phase == Phase::Turn) {
        draw();
        room.phase = Phase::River;
    } else if (room.phase == Phase::River) {
        settle_showdown_locked(room, "摊牌");
        return;
    }

    room.current = next_pending_actor_after_locked(room, room.dealer);

    if (!has_pending_actor_locked(room)) {
        runout_to_showdown_locked(room);
    }
}

bool GameHub::has_pending_actor_locked(const Room& room) const {
    return std::any_of(room.players.begin(), room.players.end(), [](const Player& p) {
        return !p.sitting_out && !p.folded && !p.all_in;
    });
}

void GameHub::runout_to_showdown_locked(Room& room) {
    auto draw = [&]() {
        if (!room.deck.empty()) {
            room.community.push_back(room.deck.back());
            room.deck.pop_back();
        }
    };

    while (room.phase != Phase::Waiting && room.phase != Phase::River) {
        if (room.phase == Phase::Preflop) {
            draw(); draw(); draw();
            room.phase = Phase::Flop;
        } else if (room.phase == Phase::Flop) {
            draw();
            room.phase = Phase::Turn;
        } else if (room.phase == Phase::Turn) {
            draw();
            room.phase = Phase::River;
        } else {
            break;
        }
    }

    if (room.phase == Phase::River) {
        settle_showdown_locked(room, "all-in 摊牌");
    }
}

void GameHub::settle_showdown_locked(Room& room, std::string reason) {
    struct Score {
        int index = -1;
        uint64_t value = 0;
    };

    std::vector<Score> scores;
    for (int i = 0; i < static_cast<int>(room.players.size()); ++i) {
        const auto& player = room.players[i];
        if (player.sitting_out || player.folded || player.committed <= 0) continue;
        std::vector<Card> seven = player.hole;
        seven.insert(seven.end(), room.community.begin(), room.community.end());
        scores.push_back(Score{i, evaluate_best_hand(seven, room.mode)});
    }

    if (scores.empty()) {
        finish_hand_locked(room);
        return;
    }

    std::vector<int> levels;
    for (const auto& player : room.players) {
        if (player.committed > 0) levels.push_back(player.committed);
    }
    std::sort(levels.begin(), levels.end());
    levels.erase(std::unique(levels.begin(), levels.end()), levels.end());

    int previous = 0;
    for (int level : levels) {
        int contributors = 0;
        for (const auto& player : room.players) {
            if (player.committed >= level) ++contributors;
        }
        const int pot_amount = (level - previous) * contributors;
        previous = level;
        if (pot_amount <= 0) continue;

        uint64_t best = 0;
        std::vector<int> winners;
        for (const auto& score : scores) {
            if (room.players[score.index].committed < level) continue;
            if (score.value > best) {
                best = score.value;
                winners = {score.index};
            } else if (score.value == best) {
                winners.push_back(score.index);
            }
        }
        if (winners.empty()) continue;

        const int share = pot_amount / static_cast<int>(winners.size());
        int remainder = pot_amount % static_cast<int>(winners.size());
        std::ostringstream msg;
        msg << reason << " 边池 " << pot_amount << "，";
        for (size_t i = 0; i < winners.size(); ++i) {
            Player& winner = room.players[winners[i]];
            const int award = share + (remainder-- > 0 ? 1 : 0);
            winner.chips += award;
            if (i) msg << "、";
            msg << winner.name << " 赢 " << award << " (" << hand_category_text(best, room.mode) << ")";
            room.current = winners[i];
        }
        emit_event_locked(room, msg.str());
    }

    finish_hand_locked(room);
}

void GameHub::finish_hand_locked(Room& room) {
    room.pot = 0;
    room.highest_bet = 0;
    room.min_raise = room.big_blind;
    room.acted.clear();
    for (auto& player : room.players) {
        player.bet = 0;
        player.committed = 0;
        player.all_in = false;
        player.folded = player.sitting_out;
        player.hole.clear();
    }
    room.phase = Phase::Waiting;
}

void GameHub::broadcast_locked(const Room& room, const std::string& text) {
    for (const auto& player : room.players) {
        auto it = sessions_.find(player.id);
        if (it != sessions_.end()) {
            if (auto session = it->second.lock()) session->send(text);
        }
    }
}

void GameHub::emit_state_locked(const Room& room) {
    std::ostringstream common;
    common << "{\"type\":\"state\",\"room\":\"" << json_escape(room.id)
           << "\",\"phase\":\"" << phase_text(room.phase)
           << "\",\"mode\":\"" << mode_text(room.mode)
           << "\",\"pot\":" << room.pot
           << ",\"highestBet\":" << room.highest_bet
           << ",\"minRaise\":" << room.min_raise
           << ",\"smallBlind\":" << room.small_blind
           << ",\"bigBlind\":" << room.big_blind
           << ",\"dealer\":\"" << (room.players.empty() || room.dealer < 0 || room.dealer >= static_cast<int>(room.players.size()) ? "" : json_escape(room.players[room.dealer].id))
           << "\",\"toAct\":\"" << (room.players.empty() || room.current < 0 || room.current >= static_cast<int>(room.players.size()) ? "" : json_escape(room.players[room.current].id))
           << "\",\"community\":[";
    for (size_t i = 0; i < room.community.size(); ++i) {
        if (i) common << ",";
        common << "\"" << room.community[i].text() << "\"";
    }
    common << "],\"players\":[";
    for (size_t i = 0; i < room.players.size(); ++i) {
        const auto& p = room.players[i];
        if (i) common << ",";
        common << "{\"id\":\"" << json_escape(p.id)
               << "\",\"name\":\"" << json_escape(p.name)
               << "\",\"chips\":" << p.chips
               << ",\"bet\":" << p.bet
               << ",\"committed\":" << p.committed
               << ",\"folded\":" << (p.folded ? "true" : "false")
               << ",\"allIn\":" << (p.all_in ? "true" : "false")
               << ",\"sittingOut\":" << (p.sitting_out ? "true" : "false")
               << "}";
    }
    common << "]}";
    const std::string public_state = common.str();

    for (const auto& player : room.players) {
        std::ostringstream personal;
        personal << "{\"type\":\"private\",\"cards\":[";
        for (size_t i = 0; i < player.hole.size(); ++i) {
            if (i) personal << ",";
            personal << "\"" << player.hole[i].text() << "\"";
        }
        personal << "]}";
        if (auto session = sessions_[player.id].lock()) {
            session->send(public_state);
            session->send(personal.str());
        }
    }
}

void GameHub::emit_event_locked(const Room& room, std::string message) {
    broadcast_locked(room, "{\"type\":\"event\",\"message\":\"" + json_escape(message) + "\"}");
}

static std::string mime_type(std::string_view path) {
    if (path.ends_with(".html")) return "text/html";
    if (path.ends_with(".css")) return "text/css";
    if (path.ends_with(".js")) return "application/javascript";
    if (path.ends_with(".json")) return "application/json";
    if (path.ends_with(".png")) return "image/png";
    if (path.ends_with(".jpg") || path.ends_with(".jpeg")) return "image/jpeg";
    if (path.ends_with(".svg")) return "image/svg+xml";
    return "application/octet-stream";
}

static http::response<http::string_body> make_string_response(
    http::status status,
    std::string body,
    unsigned version,
    bool keep_alive,
    std::string content_type = "text/plain") {
    http::response<http::string_body> res{status, version};
    res.set(http::field::server, "web-texas-webrtc");
    res.set(http::field::content_type, content_type);
    res.keep_alive(keep_alive);
    res.body() = std::move(body);
    res.prepare_payload();
    return res;
}

class HttpSession : public std::enable_shared_from_this<HttpSession> {
public:
    HttpSession(tcp::socket socket, GameHub& hub)
        : socket_(std::move(socket)), hub_(hub) {}

    void run() {
        read();
    }

private:
    tcp::socket socket_;
    GameHub& hub_;
    beast::flat_buffer buffer_;
    http::request<http::string_body> req_;

    void read() {
        http::async_read(socket_, buffer_, req_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (!ec) self->handle_request();
        });
    }

    void handle_request() {
        if (websocket::is_upgrade(req_) && req_.target() == "/ws") {
            std::make_shared<WsSession>(std::move(socket_), hub_)->run(std::move(req_));
            return;
        }

        if (req_.method() != http::verb::get && req_.method() != http::verb::head) {
            write(make_string_response(http::status::method_not_allowed, "Method not allowed", req_.version(), req_.keep_alive()));
            return;
        }

        std::string target(req_.target());
        if (target.empty() || target == "/") target = "/index.html";
        if (target.find("..") != std::string::npos) {
            write(make_string_response(http::status::bad_request, "Bad request", req_.version(), req_.keep_alive()));
            return;
        }

        std::filesystem::path file = std::filesystem::path(web_root()) / target.substr(1);
        std::ifstream in(file, std::ios::binary);
        if (!in) {
            write(make_string_response(http::status::not_found, "Not found", req_.version(), req_.keep_alive()));
            return;
        }

        std::ostringstream body;
        body << in.rdbuf();
        write(make_string_response(http::status::ok, body.str(), req_.version(), req_.keep_alive(), mime_type(file.string())));
    }

    void write(http::response<http::string_body> res) {
        auto sp = std::make_shared<http::response<http::string_body>>(std::move(res));
        http::async_write(socket_, *sp, [self = shared_from_this(), sp](beast::error_code, std::size_t) {
            beast::error_code ignored;
            self->socket_.shutdown(tcp::socket::shutdown_send, ignored);
        });
    }
};

class Listener : public std::enable_shared_from_this<Listener> {
public:
    Listener(asio::io_context& ioc, tcp::endpoint endpoint, GameHub& hub)
        : ioc_(ioc), acceptor_(ioc), hub_(hub) {
        beast::error_code ec;
        acceptor_.open(endpoint.protocol(), ec);
        if (ec) throw beast::system_error(ec);
        acceptor_.set_option(asio::socket_base::reuse_address(true), ec);
        if (ec) throw beast::system_error(ec);
        acceptor_.bind(endpoint, ec);
        if (ec) throw beast::system_error(ec);
        acceptor_.listen(asio::socket_base::max_listen_connections, ec);
        if (ec) throw beast::system_error(ec);
    }

    void run() {
        accept();
    }

private:
    asio::io_context& ioc_;
    tcp::acceptor acceptor_;
    GameHub& hub_;

    void accept() {
        acceptor_.async_accept(asio::make_strand(ioc_), [self = shared_from_this()](beast::error_code ec, tcp::socket socket) {
            if (!ec) std::make_shared<HttpSession>(std::move(socket), self->hub_)->run();
            self->accept();
        });
    }
};

int main(int argc, char* argv[]) {
    try {
        const auto address = asio::ip::make_address(argc > 1 ? argv[1] : "0.0.0.0");
        const unsigned short port = static_cast<unsigned short>(argc > 2 ? std::stoi(argv[2]) : 8080);
        const int threads = std::max(1u, std::thread::hardware_concurrency());

        asio::io_context ioc{threads};
        GameHub hub;
        std::make_shared<Listener>(ioc, tcp::endpoint{address, port}, hub)->run();

        std::vector<std::thread> pool;
        pool.reserve(threads - 1);
        for (int i = 1; i < threads; ++i) pool.emplace_back([&] { ioc.run(); });

        std::cout << "Serving http://" << address.to_string() << ":" << port << "\n";
        ioc.run();
        for (auto& t : pool) t.join();
    } catch (const std::exception& e) {
        std::cerr << "fatal: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
