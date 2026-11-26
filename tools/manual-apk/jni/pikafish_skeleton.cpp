/* Safe fallback skeleton: no Pikafish code, no NNUE weights. */
#include <jni.h>
#include <stdio.h>
#include <string.h>

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_xiangqi_trainer_MainActivity_nativeEngineStatus(JNIEnv* env, jobject /*thiz*/) {
    return env->NewStringUTF(
        "Pikafish JNI skeleton ready; NNUE weights absent; move selection NOT delegated");
}

JNIEXPORT jstring JNICALL
Java_com_xiangqi_trainer_MainActivity_nativeQueryEngine(
        JNIEnv* env, jobject /*thiz*/, jstring uciPosition) {
    const char* input = uciPosition == nullptr ? "" : env->GetStringUTFChars(uciPosition, nullptr);
    size_t len = input == nullptr ? 0 : strlen(input);
    char out[128];
    snprintf(out, sizeof(out), "SKELETON_NO_NNUE|bytes=%zu", len);
    if (uciPosition != nullptr && input != nullptr) {
        env->ReleaseStringUTFChars(uciPosition, input);
    }
    return env->NewStringUTF(out);
}

}  // extern "C"
