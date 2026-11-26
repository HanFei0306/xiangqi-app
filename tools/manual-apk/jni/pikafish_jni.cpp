/*
 * Real Pikafish JNI bridge — pikafish-nc build only (v2026.11.20.3).
 *
 * GPLv3: this file is a derivative work of the Android host glue and links
 * against unmodified Pikafish sources in tools/pikafish-src. NNUE weights are
 * downloaded separately and are NON-COMMERCIAL. Never ship this library in a
 * commercial build without replacing the network.
 *
 * Protocol (nativeQueryEngine):
 *   line 1: depth <int>
 *   line 2: fen <9-rank FEN>
 *   line 3: moves <uci1 uci2 ...>   (may be empty)
 * Returns the raw "bestmove xxxx" text, or "bestmove (none)" on error.
 */
#include <jni.h>

#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "misc.h"
#include "tune.h"
#include "uci.h"

namespace {

std::unique_ptr<Stockfish::UCIEngine> g_engine;

std::string jstring_to_string(JNIEnv* env, jstring value) {
    if (value == nullptr) return "";
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string out = chars == nullptr ? "" : chars;
    if (chars != nullptr) env->ReleaseStringUTFChars(value, chars);
    return out;
}

std::vector<std::string> split_ws(const std::string& text) {
    std::vector<std::string> out;
    std::istringstream is(text);
    std::string token;
    while (is >> token) out.push_back(token);
    return out;
}

}  // namespace

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_xiangqi_trainer_MainActivity_nativePikafishInit(
        JNIEnv* env, jobject /*thiz*/, jstring netPath, jint hashMb, jint threads) {
    if (g_engine) return env->NewStringUTF("already-initialized");
    // Pikafish is built with -fno-exceptions; init failures are fatal by design.
    Stockfish::Attacks::init();
    char program[] = "pikafish";
    char* argv[] = {program};
    auto cli = Stockfish::CommandLine(1, argv);
    g_engine.reset(new Stockfish::UCIEngine(std::move(cli)));
    Stockfish::Tune::init(g_engine->engine_options());

    std::ostringstream sink;
    std::streambuf* old = std::cout.rdbuf(sink.rdbuf());
    std::string path = jstring_to_string(env, netPath);
    g_engine->setoption_jni("name Hash value " + std::to_string(hashMb));
    g_engine->setoption_jni("name Threads value " + std::to_string(threads));
    if (!path.empty()) {
        g_engine->setoption_jni("name EvalFile value " + path);
    }
    g_engine->clear_jni();  // forces network load before the first move
    std::cout.rdbuf(old);
    return env->NewStringUTF("ok");
}

JNIEXPORT jstring JNICALL
Java_com_xiangqi_trainer_MainActivity_nativePikafishQuery(
        JNIEnv* env, jobject /*thiz*/, jstring request) {
    if (!g_engine) return env->NewStringUTF("bestmove (none)");
    std::string text = jstring_to_string(env, request);
    std::istringstream is(text);
    std::string line;
    int depth = 12;
    int movetime = 0;  // 0 = rely on depth only
    std::string fen = Stockfish::StartFEN;
    std::vector<std::string> moves;

    while (std::getline(is, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        auto words = split_ws(line);
        if (words.empty()) continue;
        if (words[0] == "depth" && words.size() >= 2) depth = std::stoi(words[1]);
        else if (words[0] == "movetime" && words.size() >= 2) movetime = std::stoi(words[1]);
        else if (words[0] == "fen") {
            fen.clear();
            for (size_t i = 1; i < words.size(); ++i) {
                if (!fen.empty()) fen += " ";
                fen += words[i];
            }
        } else if (words[0] == "moves") {
            for (size_t i = 1; i < words.size(); ++i) moves.push_back(words[i]);
        }
    }

    g_engine->set_position_jni(fen, moves);
    Stockfish::Search::LimitsType limits;
    limits.depth = depth;
    if (movetime > 0) limits.movetime = movetime;
    limits.startTime = Stockfish::now();

    std::ostringstream captured;
    std::streambuf* old = std::cout.rdbuf(captured.rdbuf());
    g_engine->go_jni(limits);
    g_engine->wait_jni();
    std::cout.rdbuf(old);

    const std::string output = captured.str();
    const size_t pos = output.rfind("bestmove");
    if (pos == std::string::npos) return env->NewStringUTF("bestmove (none)");
    const size_t end = output.find('\n', pos);
    std::string result = output.substr(pos, end == std::string::npos
                                            ? std::string::npos : end - pos);
    while (!result.empty() && result.back() == '\r') result.pop_back();
    return env->NewStringUTF(result.c_str());
}

}  // extern "C"
