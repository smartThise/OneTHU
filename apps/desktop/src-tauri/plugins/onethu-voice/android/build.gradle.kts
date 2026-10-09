plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// exFAT 兼容（与 onethu-speech 同）：产物挪到 APFS/本地盘，避开 ._ 资源叉重复类报错
layout.buildDirectory.set(file("/tmp/onethu-android-plugin-build/onethu-voice"))

android {
    namespace = "app.onethu.voice"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("org.apache.commons:commons-compress:1.27.1")
    implementation(project(":tauri-android"))
}
